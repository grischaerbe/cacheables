//region Types
export interface CacheOptions {
  /**
   * Enables caching
   */
  enabled?: boolean
  /**
   * Enable/disable cache hits and misses
   */
  log?: boolean
  /**
   * Enable/disable timings
   */
  logTiming?: boolean
}
//endregion

//region Cacheables
/**
 * Provides a simple in-memory cache with automatic or manual invalidation.
 */
export class Cacheables {
  public enabled: boolean
  public log: boolean
  public logTiming: boolean

  constructor(options?: CacheOptions) {
    this.enabled = options?.enabled ?? true
    this.log = options?.log ?? false
    this.logTiming = options?.logTiming ?? false
  }

  private cacheables: Record<string, Cacheable<any>> = {}

  /**
   * Builds a key with the provided strings or numbers.
   * @param args
   */
  public static key(...args: (string | number)[]): string {
    return args.join(':')
  }

  /**
   * Deletes a cacheable.
   * @param key
   */
  public delete(key: string): void {
    delete this.cacheables[key]
  }

  /**
   * Clears the cache by deleting all cacheables.
   */
  public clear(): void {
    this.cacheables = {}
  }

  /**
   * Returns whether a cacheable is present and valid (i.e., did not time out).
   */
  public isCached(key: string): boolean {
    const cacheable = this.cacheables[key]
    return !(!cacheable || cacheable.timedOut)
  }

  /**
   * Returns all the cache keys
   */
  public keys(): string[] {
    return Object.keys(this.cacheables)
  }

  /**
   * A "cacheable" represents a resource, commonly fetched from a remote source
   * that you want to cache for a certain period of time.
   * @param resource A function returning a Promise
   * @param key A key to identify the cache
   * @param timeout A timeout in milliseconds to automatically invalidate
   * the cache (optional)
   * @example
   * const apiResponse = await cache.cacheable(
   *   () => api.query({
   *     query: someQuery,
   *     variables: someVariables,
   *   }),
   *   Cache.key('type', someCacheKey, someOtherCacheKey),
   *   60e3
   * )
   * @returns promise Resolves to the value of the provided resource, either from
   * cache or from the remote resource itself.
   */
  public async cacheable<T>(
    resource: () => Promise<T>,
    key: string,
    timeout?: number,
  ): Promise<T> {
    const shouldCache = this.enabled
    if (!shouldCache) {
      if (this.log) Logger.logDisabled()
      return resource()
    }

    // Persist log settings as this could be a race condition
    const { logTiming, log } = this
    if (logTiming) Logger.logTime(key)

    const result = await this.#cacheable(resource, key, timeout)

    if (logTiming) Logger.logTimeEnd(key)
    if (log) Logger.logStats(key, this.cacheables[key])

    return result
  }

  async #cacheable<T>(
    resource: () => Promise<T>,
    key: string,
    timeout?: number,
  ): Promise<T> {
    const cacheable = this.cacheables[key] as Cacheable<T> | undefined

    if (!cacheable) {
      this.cacheables[key] = await Cacheable.create(resource, timeout)
      return this.cacheables[key]?.value
    }

    return await cacheable.touch(resource, timeout)
  }
}
//endregion

//region Cacheable
/**
 * Helper class, can only be instantiated by calling its static
 * function `create`.
 */
class Cacheable<T> {
  private timingOutAt: number | undefined
  public hits = 0
  public misses = 1
  public value: T

  /**
   * Cacheable Factory function. The only way to get a cacheable.
   * @param resource
   * @param timeout
   */
  static async create<T>(resource: () => Promise<T>, timeout?: number) {
    const timesOutAt = timeout !== undefined ? Date.now() + timeout : undefined
    const value = await resource()
    return new Cacheable(value, timesOutAt)
  }

  private constructor(value: T, timesOutAt?: number) {
    this.value = value
    this.timingOutAt = timesOutAt
  }

  get timedOut(): boolean {
    if (this.timingOutAt === undefined) return false
    return this.timingOutAt < Date.now()
  }

  /**
   * Get and set the value of the Cacheable.
   * Some tricky race are conditions going on here,
   * but this should behave as expected
   * @param resource
   * @param timeout
   */
  async touch(resource: () => Promise<T>, timeout?: number): Promise<T> {
    if (!this.timedOut) {
      this.hits += 1
      this.timingOutAt =
        timeout !== undefined ? Date.now() + timeout : undefined
      return this.value
    }
    this.timingOutAt = timeout !== undefined ? Date.now() + timeout : undefined
    this.value = await resource()
    this.misses += 1
    return this.value
  }
}
//endregion

//region Logger
/**
 * Logger class with static logging functions.
 */
class Logger {
  static logTime(key: string): void {
    // eslint-disable-next-line no-console
    console.time(key)
  }

  static logTimeEnd(key: string): void {
    // eslint-disable-next-line no-console
    console.timeEnd(key)
  }

  static logDisabled(): void {
    // eslint-disable-next-line no-console
    console.log('CACHE: Caching disabled')
  }

  static logStats(key: string, cacheable: Cacheable<any> | undefined) {
    if (!cacheable) return
    const { hits, misses } = cacheable
    console.log(`Cacheable "${key}": hits: ${hits}, misses: ${misses}`)
  }
}
//endregion
