import type {
  BucketEntryMeta,
  CacheableOptions,
  IBucket,
  ILogger,
  Policy,
} from './types'

type FreshnessPredicate = (meta: BucketEntryMeta) => boolean

type CascadeFn<R> = (
  fullKey: string,
  isFresh?: FreshnessPredicate,
) => Promise<{ result: R; meta: BucketEntryMeta } | undefined>

export class Cacheable<TView = void> {
  logger: ILogger | undefined

  #policy: Policy
  #maxAge: number | undefined
  #buckets: IBucket<TView>[]
  #namespace: string
  #policyInflight = new Map<string, Promise<unknown>>()
  #producerInflight = new Map<string, Promise<unknown>>()

  constructor(namespace: string, options: CacheableOptions<TView>) {
    if (!options.buckets || options.buckets.length === 0) {
      throw new Error('At least one bucket is required')
    }
    this.#buckets = options.buckets
    this.#namespace = namespace
    this.logger = options.logger
    this.#policy = options.policy ?? 'cache-only'
    this.#maxAge =
      options.policy === 'max-age' ||
      options.policy === 'stale-while-revalidate'
        ? options.maxAge
        : undefined
  }

  #fullKey(key: string): string {
    return `${this.#namespace}:${key}`
  }

  #dedupKey(key: string, type: 'value' | 'view'): string {
    return `${this.#namespace}:${key}:${type}`
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.#fullKey(key)
    // Drop any in-flight registrations for this key so a producer that
    // is mid-fetch when delete() is called can't be reused as if it
    // were fresh, and so a subsequent remember()/resolve() does not
    // attach to a soon-to-be-stale promise.
    // TODO: thread an AbortSignal through #produceAndWrite so an
    // in-flight producer's network work is actually cancelled here,
    // not just orphaned.
    this.#policyInflight.delete(this.#dedupKey(key, 'value'))
    this.#policyInflight.delete(this.#dedupKey(key, 'view'))
    this.#producerInflight.delete(fullKey)
    await Promise.all(this.#buckets.map((b) => b.delete(fullKey)))
  }

  async clear(): Promise<void> {
    this.#policyInflight.clear()
    this.#producerInflight.clear()
    await Promise.all(this.#buckets.map((b) => b.clear()))
  }

  async remember<T>(resource: () => Promise<T>, key: string): Promise<T> {
    const { logger } = this
    const start = logger ? performance.now() : 0

    const fullKey = this.#fullKey(key)
    const dedupKey = this.#dedupKey(key, 'value')
    const { result, hit } = await this.#runPolicy<T, T>(
      resource,
      fullKey,
      dedupKey,
      (k, isFresh) => this.#cascadeRead<T>(k, isFresh),
      async (value) => value,
    )

    if (logger) {
      const elapsed = Math.round((performance.now() - start) * 10) / 10
      logger.log(
        `Cacheable "${this.#namespace}:${key}": ${hit ? 'HIT' : 'MISS'} ${elapsed}ms`,
      )
    }

    return result
  }

  async resolve<T>(resource: () => Promise<T>, key: string): Promise<TView> {
    const { logger } = this
    const start = logger ? performance.now() : 0

    const fullKey = this.#fullKey(key)
    const dedupKey = this.#dedupKey(key, 'view')
    const { result, hit } = await this.#runPolicy<T, TView>(
      resource,
      fullKey,
      dedupKey,
      (k, isFresh) => this.#cascadeResolve(k, isFresh),
      () => this.#viewFromL1(fullKey),
    )

    if (logger) {
      const elapsed = Math.round((performance.now() - start) * 10) / 10
      logger.log(
        `Cacheable "${this.#namespace}:${key}": ${hit ? 'HIT' : 'MISS'} ${elapsed}ms`,
      )
    }

    return result
  }

  async #viewFromL1(fullKey: string): Promise<TView> {
    const wrapped = await this.#buckets[0]!.view(fullKey)
    if (wrapped === undefined) {
      throw new Error(
        `Cacheable: L1 bucket returned no view for "${fullKey}" after a successful cascade write`,
      )
    }
    return wrapped.view
  }

  async #runPolicy<T, R>(
    resource: () => Promise<T>,
    fullKey: string,
    dedupKey: string,
    cascadeFn: CascadeFn<R>,
    fromValue: (value: T) => Promise<R>,
  ): Promise<{ result: R; hit: boolean }> {
    switch (this.#policy) {
      case 'cache-only': {
        return this.#dedupPolicy(dedupKey, async () => {
          const cached = await cascadeFn(fullKey)
          if (cached) return { result: cached.result, hit: true }
          const value = await this.#produceAndWrite(fullKey, resource)
          return { result: await fromValue(value), hit: false }
        })
      }
      case 'network-only': {
        const value = await resource()
        await this.#cascadeWrite(fullKey, value)
        return { result: await fromValue(value), hit: false }
      }
      case 'network-only-non-concurrent': {
        return this.#dedupPolicy(dedupKey, async () => {
          const value = await this.#produceAndWrite(fullKey, resource)
          return { result: await fromValue(value), hit: false }
        })
      }
      case 'max-age': {
        const maxAge = this.#maxAge as number
        return this.#dedupPolicy(dedupKey, async () => {
          const cached = await cascadeFn(
            fullKey,
            (m) => Date.now() - m.storedAt <= maxAge,
          )
          if (cached) return { result: cached.result, hit: true }
          const value = await this.#produceAndWrite(fullKey, resource)
          return { result: await fromValue(value), hit: false }
        })
      }
      case 'stale-while-revalidate': {
        return this.#dedupPolicy(dedupKey, async () => {
          const cached = await cascadeFn(fullKey)
          const maxAge = this.#maxAge
          const isStale =
            !cached ||
            maxAge === undefined ||
            Date.now() - cached.meta.storedAt > maxAge

          if (cached && !isStale) {
            return { result: cached.result, hit: true }
          }

          if (cached && isStale) {
            this.#produceAndWrite(fullKey, resource).catch(() => {
              /* swallow background revalidation errors */
            })
            return { result: cached.result, hit: true }
          }

          const value = await this.#produceAndWrite(fullKey, resource)
          return { result: await fromValue(value), hit: false }
        })
      }
    }
  }

  async #produceAndWrite<T>(
    fullKey: string,
    resource: () => Promise<T>,
  ): Promise<T> {
    return this.#dedup(this.#producerInflight, fullKey, async () => {
      const value = await resource()
      await this.#cascadeWrite(fullKey, value)
      return value
    })
  }

  #dedupPolicy<T>(dedupKey: string, run: () => Promise<T>): Promise<T> {
    return this.#dedup(this.#policyInflight, dedupKey, run)
  }

  #dedup<T>(
    inflight: Map<string, Promise<unknown>>,
    key: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const existing = inflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const p = run().finally(() => {
      if (inflight.get(key) === p) inflight.delete(key)
    })
    inflight.set(key, p)
    return p
  }

  async #cascadeProbe(
    fullKey: string,
  ): Promise<(BucketEntryMeta | undefined)[]> {
    return Promise.all(this.#buckets.map((b) => b.meta(fullKey)))
  }

  #findHitIdx(
    probes: (BucketEntryMeta | undefined)[],
    isFresh?: FreshnessPredicate,
  ): number {
    return probes.findIndex(
      (m) => m !== undefined && (isFresh ? isFresh(m) : true),
    )
  }

  async #cascadeRead<T>(
    fullKey: string,
    isFresh?: FreshnessPredicate,
  ): Promise<{ result: T; meta: BucketEntryMeta } | undefined> {
    const probes = await this.#cascadeProbe(fullKey)
    const hitIdx = this.#findHitIdx(probes, isFresh)
    if (hitIdx === -1) return undefined

    const bucket = this.#buckets[hitIdx]!
    const result = await bucket.read<T>(fullKey)
    if (result === undefined) return undefined

    const value = result.value
    const hitMeta = probes[hitIdx]!
    await this.#cascadeFill(fullKey, value, hitMeta, probes, hitIdx, isFresh)
    return { result: value, meta: hitMeta }
  }

  async #cascadeResolve(
    fullKey: string,
    isFresh?: FreshnessPredicate,
  ): Promise<{ result: TView; meta: BucketEntryMeta } | undefined> {
    const probes = await this.#cascadeProbe(fullKey)
    const hitIdx = this.#findHitIdx(probes, isFresh)
    if (hitIdx === -1) return undefined

    const hitMeta = probes[hitIdx]!
    const needsFill = probes.some(
      (m, i) =>
        i !== hitIdx && (m === undefined || (isFresh ? !isFresh(m) : false)),
    )

    if (!needsFill) {
      const wrapped = await this.#buckets[0]!.view(fullKey)
      if (wrapped === undefined) return undefined
      return { result: wrapped.view, meta: hitMeta }
    }

    const result = await this.#buckets[hitIdx]!.read<unknown>(fullKey)
    if (result === undefined) return undefined

    await this.#cascadeFill(
      fullKey,
      result.value,
      hitMeta,
      probes,
      hitIdx,
      isFresh,
    )
    const wrapped = await this.#buckets[0]!.view(fullKey)
    if (wrapped === undefined) {
      if (hitIdx !== 0) {
        // cascadeFill just wrote to L1. Absence here is a strict-mode
        // error per the IBucket contract.
        throw new Error(
          `Cacheable: L1 bucket returned no view for "${fullKey}" after a successful cascade fill`,
        )
      }
      // hitIdx === 0: cascadeFill skipped L1; the entry was raced away
      // between the meta probe and the post-fill view. Heal by falling
      // through to the producer.
      return undefined
    }
    return { result: wrapped.view, meta: hitMeta }
  }

  async #cascadeFill<T>(
    fullKey: string,
    value: T,
    hitMeta: BucketEntryMeta,
    probes: (BucketEntryMeta | undefined)[],
    hitIdx: number,
    isFresh?: FreshnessPredicate,
  ): Promise<void> {
    const writes: Promise<void>[] = []
    for (let i = 0; i < this.#buckets.length; i++) {
      if (i === hitIdx) continue
      const probe = probes[i]
      if (probe !== undefined && (!isFresh || isFresh(probe))) continue
      writes.push(this.#buckets[i]!.write(fullKey, value, hitMeta))
    }
    if (writes.length > 0) await Promise.all(writes)
  }

  async #cascadeWrite<T>(fullKey: string, value: T): Promise<void> {
    const meta: BucketEntryMeta = { storedAt: Date.now() }
    await Promise.all(this.#buckets.map((b) => b.write(fullKey, value, meta)))
  }
}
