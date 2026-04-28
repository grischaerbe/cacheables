import type {
  CacheableOptions,
  IBaseMeta,
  IBucket,
  ILogger,
  Policy,
} from './types'

export class Cacheable<TMeta extends IBaseMeta = IBaseMeta> {
  logger: ILogger | undefined

  #policy: Policy
  #maxAge: number | undefined
  #buckets: IBucket<TMeta>[]
  #namespace: string
  #inflight = new Map<string, Promise<unknown>>()

  constructor(namespace: string, options: CacheableOptions<TMeta>) {
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

  static key(...args: (string | number)[]): string {
    return args.join(':')
  }

  #fullKey(key: string): string {
    return `${this.#namespace}:${key}`
  }

  async delete(key: string): Promise<void> {
    const fullKey = this.#fullKey(key)
    await Promise.all(this.#buckets.map((b) => b.delete(fullKey)))
  }

  async clear(): Promise<void> {
    this.#inflight.clear()
    await Promise.all(this.#buckets.map((b) => b.clear()))
  }

  async meta(key: string): Promise<TMeta | undefined> {
    const fullKey = this.#fullKey(key)
    const probes = await this.#cascadeProbe(fullKey)
    return probes.find((m) => m !== undefined)
  }

  async remember<T>(resource: () => Promise<T>, key: string): Promise<T> {
    const { logger } = this
    const start = logger ? performance.now() : 0

    const fullKey = this.#fullKey(key)
    const { value, hit } = await this.#runPolicy<T>(resource, fullKey)

    if (logger) {
      const elapsed = Math.round((performance.now() - start) * 10) / 10
      logger.log(`Cacheable "${key}": ${hit ? 'HIT' : 'MISS'} ${elapsed}ms`)
    }

    return value
  }

  async resolve<T>(resource: () => Promise<T>, key: string): Promise<TMeta> {
    const { logger } = this
    const start = logger ? performance.now() : 0

    const fullKey = this.#fullKey(key)
    const { meta, hit } = await this.#runPolicy<T>(resource, fullKey)

    if (logger) {
      const elapsed = Math.round((performance.now() - start) * 10) / 10
      logger.log(`Cacheable "${key}": ${hit ? 'HIT' : 'MISS'} ${elapsed}ms`)
    }

    return meta
  }

  async #runPolicy<T>(
    resource: () => Promise<T>,
    fullKey: string,
  ): Promise<{ value: T; hit: boolean; meta: TMeta }> {
    switch (this.#policy) {
      case 'cache-only': {
        return this.#dedup(fullKey, async () => {
          const cached = await this.#cascadeRead<T>(fullKey)
          if (cached)
            return { value: cached.value, hit: true, meta: cached.meta }
          const value = await resource()
          const meta = await this.#cascadeWrite(fullKey, value)
          return { value, hit: false, meta }
        })
      }
      case 'network-only': {
        const value = await resource()
        const meta = await this.#cascadeWrite(fullKey, value)
        return { value, hit: false, meta }
      }
      case 'network-only-non-concurrent': {
        return this.#dedup(fullKey, async () => {
          const value = await resource()
          const meta = await this.#cascadeWrite(fullKey, value)
          return { value, hit: false, meta }
        })
      }
      case 'max-age': {
        const maxAge = this.#maxAge as number
        return this.#dedup(fullKey, async () => {
          const cached = await this.#cascadeRead<T>(
            fullKey,
            (m) => Date.now() - m.storedAt <= maxAge,
          )
          if (cached)
            return { value: cached.value, hit: true, meta: cached.meta }
          const value = await resource()
          const meta = await this.#cascadeWrite(fullKey, value)
          return { value, hit: false, meta }
        })
      }
      case 'stale-while-revalidate': {
        const cached = await this.#cascadeRead<T>(fullKey)
        const maxAge = this.#maxAge
        const isStale =
          !cached ||
          maxAge === undefined ||
          Date.now() - cached.meta.storedAt > maxAge

        if (cached && !isStale) {
          return { value: cached.value, hit: true, meta: cached.meta }
        }

        if (cached && isStale) {
          this.#dedup(fullKey, async () => {
            const value = await resource()
            const meta = await this.#cascadeWrite(fullKey, value)
            return { value, hit: false, meta }
          }).catch(() => {
            /* swallow background revalidation errors */
          })
          return { value: cached.value, hit: true, meta: cached.meta }
        }

        return this.#dedup(fullKey, async () => {
          const value = await resource()
          const meta = await this.#cascadeWrite(fullKey, value)
          return { value, hit: false, meta }
        })
      }
    }
  }

  #dedup<T>(fullKey: string, run: () => Promise<T>): Promise<T> {
    const existing = this.#inflight.get(fullKey) as Promise<T> | undefined
    if (existing) return existing
    const p = run().finally(() => {
      if (this.#inflight.get(fullKey) === p) this.#inflight.delete(fullKey)
    })
    this.#inflight.set(fullKey, p)
    return p
  }

  async #cascadeProbe(fullKey: string): Promise<(TMeta | undefined)[]> {
    return Promise.all(this.#buckets.map((b) => b.meta(fullKey)))
  }

  async #cascadeRead<T>(
    fullKey: string,
    isFresh?: (meta: TMeta) => boolean,
  ): Promise<{ value: T; meta: TMeta } | undefined> {
    const probes = await this.#cascadeProbe(fullKey)
    const hitIdx = probes.findIndex(
      (m) => m !== undefined && (isFresh ? isFresh(m) : true),
    )
    if (hitIdx === -1) return undefined

    const bucket = this.#buckets[hitIdx]!
    const result = await bucket.read<T>(fullKey)
    if (result === undefined) return undefined

    const value = result.value
    const hitMeta = probes[hitIdx] as TMeta
    await this.#cascadeFill(fullKey, value, hitMeta, probes, hitIdx)
    return { value, meta: hitMeta }
  }

  async #cascadeFill<T>(
    fullKey: string,
    value: T,
    hitMeta: TMeta,
    probes: (TMeta | undefined)[],
    hitIdx: number,
  ): Promise<void> {
    const writes: Promise<void>[] = []
    for (let i = 0; i < this.#buckets.length; i++) {
      if (i === hitIdx) continue
      if (probes[i] !== undefined) continue
      writes.push(this.#buckets[i]!.write(fullKey, value, hitMeta))
    }
    if (writes.length > 0) await Promise.all(writes)
  }

  async #cascadeWrite<T>(fullKey: string, value: T): Promise<TMeta> {
    const [l1, ...rest] = this.#buckets
    if (l1 === undefined) {
      throw new Error('At least one bucket is required')
    }
    await l1.write(fullKey, value)
    const meta = await l1.meta(fullKey)
    if (meta === undefined) {
      throw new Error('L1 bucket did not persist meta after write')
    }
    if (rest.length > 0) {
      await Promise.all(rest.map((b) => b.write(fullKey, value, meta)))
    }
    return meta
  }
}
