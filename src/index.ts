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
  public isCached(key: string, maxAge?: number): boolean {
    const cacheable = this.cacheables[key]
    if (!cacheable) return false
    /**
     * If no maxAge is provided, we assume that
     * whatever value is present is still a valid cache
     */
    if (maxAge === undefined) return true
    /**
     * If the maxAge provided is 0, we assume that
     * whatever value is present is invalid
     */
    if (maxAge === 0) return false
    /**
     * If a maxAge is provided, we check against
     * the timestamp of the last fetch
     */
    return !cacheable.timedOut(maxAge)
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
   * @param maxAge A maxAge in milliseconds to automatically invalidate
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
    maxAge?: number,
  ): Promise<T> {
    const shouldCache = this.enabled
    if (!shouldCache) {
      if (this.log) Logger.logDisabled()
      return resource()
    }

    // Persist log settings as this could be a race condition
    const { logTiming, log } = this
    if (logTiming) Logger.logTime(key)

    const result = await this.#cacheable(resource, key, maxAge)

    if (logTiming) Logger.logTimeEnd(key)
    if (log) Logger.logStats(key, this.cacheables[key])

    return result
  }

  async #cacheable<T>(
    resource: () => Promise<T>,
    key: string,
    maxAge?: number,
  ): Promise<T> {
    const cacheable = this.cacheables[key] as Cacheable<T> | undefined

    if (!cacheable) {
      this.cacheables[key] = await Cacheable.create(resource)
      return this.cacheables[key]?.value
    }

    return await cacheable.touch(resource, maxAge)
  }
}
//endregion

//region Cacheable
/**
 * Helper class, can only be instantiated by calling its static
 * function `create`.
 */
class Cacheable<T> {
  public hits = 0
  public misses = 0
  private lastFetch: number | undefined

  // TODO: This feels a bit dirty
  #value: T = undefined as unknown as T

  public get value(): T {
    return this.#value
  }
  private set value(v) {
    this.#value = v
  }

  /**
   * Cacheable Factory function. The only way to get a cacheable.
   * @param resource
   */
  static async create<T>(resource: () => Promise<T>) {
    const cacheable = new Cacheable()
    await cacheable.touch(resource)
    return cacheable
  }

  private async fetch(resource: () => Promise<T>) {
    this.lastFetch = Date.now()
    this.value = await resource()
    return this.value
  }

  private async handleMiss(resource: () => Promise<T>) {
    this.misses += 1
    return this.fetch(resource)
  }

  private async handleHit() {
    this.hits += 1
    return this.value
  }

  public timedOut(maxAge: number): boolean {
    if (!this.lastFetch) return true
    return Date.now() > this.lastFetch + maxAge
  }

  /**
   * Get and set the value of the Cacheable.
   * Some tricky race are conditions going on here,
   * but this should behave as expected
   * @param resource
   * @param maxAge
   */
  async touch(resource: () => Promise<T>, maxAge?: number): Promise<T> {
    if (!this.lastFetch) {
      return this.fetch(resource)
    } else if (maxAge) {
      return this.timedOut(maxAge)
        ? this.handleMiss(resource)
        : this.handleHit()
    } else {
      return this.handleHit()
    }
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

  static logStats(key: string, cacheable: Cacheable<any> | undefined): void {
    if (!cacheable) return
    const { hits, misses } = cacheable
    console.log(`Cacheable "${key}": hits: ${hits}, misses: ${misses}`)
  }
}
//endregion
