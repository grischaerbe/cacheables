import { Logger } from './Logger'
import type {
  CacheableOptions,
  IBaseMeta,
  IBucket,
  Policy,
} from './types'

export class Cacheable<TMeta extends IBaseMeta = IBaseMeta> {
  log: boolean
  logTiming: boolean

  #policy: Policy
  #maxAge: number | undefined
  #buckets: IBucket<TMeta>[]
  #namespace: string
  #inflight = new Map<string, Promise<unknown>>()
  #hits = new Map<string, number>()

  constructor(options: CacheableOptions<TMeta>) {
    if (!options.buckets || options.buckets.length === 0) {
      throw new Error('At least one bucket is required')
    }
    this.#buckets = options.buckets
    this.#namespace = options.namespace
    this.log = options.log ?? false
    this.logTiming = options.logTiming ?? false
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
    this.#hits.delete(fullKey)
    await Promise.all(this.#buckets.map((b) => b.delete(fullKey)))
  }

  async clear(): Promise<void> {
    this.#inflight.clear()
    this.#hits.clear()
    await Promise.all(this.#buckets.map((b) => b.clear()))
  }

  async isCached(key: string): Promise<boolean> {
    const fullKey = this.#fullKey(key)
    const probes = await this.#cascadeProbe(fullKey)
    return probes.some((m) => m !== undefined)
  }

  async meta(key: string): Promise<TMeta | undefined> {
    const fullKey = this.#fullKey(key)
    const probes = await this.#cascadeProbe(fullKey)
    return probes.find((m) => m !== undefined)
  }

  async remember<T>(resource: () => Promise<T>, key: string): Promise<T> {
    const { logTiming, log } = this
    const logId = Logger.getLogId(key)
    if (logTiming) Logger.logTime(logId)

    const fullKey = this.#fullKey(key)
    const { value, hit } = await this.#runPolicy<T>(resource, fullKey)

    if (hit) {
      const next = (this.#hits.get(fullKey) ?? 0) + 1
      this.#hits.set(fullKey, next)
    } else if (!this.#hits.has(fullKey)) {
      this.#hits.set(fullKey, 0)
    }

    if (logTiming) Logger.logTimeEnd(logId)
    if (log) Logger.logStats(key, this.#hits.get(fullKey) ?? 0)

    return value
  }

  async #runPolicy<T>(
    resource: () => Promise<T>,
    fullKey: string,
  ): Promise<{ value: T; hit: boolean }> {
    switch (this.#policy) {
      case 'cache-only': {
        return this.#dedup(fullKey, async () => {
          const cached = await this.#cascadeRead<T>(fullKey)
          if (cached) return { value: cached.value, hit: true }
          const value = await resource()
          await this.#cascadeWrite(fullKey, value)
          return { value, hit: false }
        })
      }
      case 'network-only': {
        const value = await resource()
        await this.#cascadeWrite(fullKey, value)
        return { value, hit: false }
      }
      case 'network-only-non-concurrent': {
        return this.#dedup(fullKey, async () => {
          const value = await resource()
          await this.#cascadeWrite(fullKey, value)
          return { value, hit: false }
        })
      }
      case 'max-age': {
        const maxAge = this.#maxAge as number
        return this.#dedup(fullKey, async () => {
          const cached = await this.#cascadeRead<T>(
            fullKey,
            (m) => Date.now() - m.storedAt <= maxAge,
          )
          if (cached) return { value: cached.value, hit: true }
          const value = await resource()
          await this.#cascadeWrite(fullKey, value)
          return { value, hit: false }
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
          return { value: cached.value, hit: true }
        }

        if (cached && isStale) {
          this.#dedup(fullKey, async () => {
            const value = await resource()
            await this.#cascadeWrite(fullKey, value)
            return { value, hit: false }
          }).catch(() => {
            /* swallow background revalidation errors */
          })
          return { value: cached.value, hit: true }
        }

        return this.#dedup(fullKey, async () => {
          const value = await resource()
          await this.#cascadeWrite(fullKey, value)
          return { value, hit: false }
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

  async #cascadeWrite<T>(fullKey: string, value: T): Promise<void> {
    const [l1, ...rest] = this.#buckets
    if (l1 === undefined) return
    await l1.write(fullKey, value)
    if (rest.length === 0) return
    const meta = await l1.meta(fullKey)
    if (meta === undefined) {
      throw new Error('L1 bucket did not persist meta after write')
    }
    await Promise.all(rest.map((b) => b.write(fullKey, value, meta)))
  }
}
