export interface CacheOptions {
  /**
   * Enables cacheing
   */
  enabled?: boolean
  /**
   * Should log data
   */
  log?: boolean
  /**
   * Should log timing
   */
  logTiming?: boolean
}

/**
 * Provides a simple in-memory cache with automatic or manual invalidation.
 */
export class Cacheables {
  public enabled: boolean
  private log: Logger | undefined

  constructor(options?: CacheOptions) {
    this.enabled = options?.enabled ?? true
    if (options?.log === true)
      this.log = new Logger(options?.logTiming ?? false)
  }

  private cache: Record<
    string,
    {
      timer?: ReturnType<typeof setTimeout>
      value: any
      misses: number
      hits: number
    }
  > = {}

  private clearValue(key: string): void {
    if (this.cache[key] && this.cache[key]?.value) {
      delete this.cache[key]?.value
      this.log?.logInvalidatingCache(key)
    }
  }

  private clearTimeout(key: string): void {
    if (this.cache[key] && this.cache[key]?.timer) {
      clearTimeout(this.cache[key]?.timer as ReturnType<typeof setTimeout>)
    }
  }

  /**
   * Build a key by providing strings or numbers
   * @param args
   */
  public static key(...args: (string | number)[]): string {
    return args.join(':')
  }

  public delete(key: string): void {
    this.clearTimeout(key)
    this.clearValue(key)
  }

  public clear(): void {
    Object.keys(this.cache).forEach(this.delete)
  }

  /**
   * Returns all the cache keys
   */
  public keys(): string[] {
    return Object.keys(this.cache)
  }

  /**
   * A "cacheable" represents a resource, commonly fetched from a remote source
   * that you want to cache for a certain period of time.
   * @param resource A function returning a Promise
   * @param key A key to identify the cache
   * @param timeout A timeout in milliseconds to automatically invalidate
   * the cache (optional)
   * @example
   * const myApiResponse = await myCache.cacheable(
   *   () => myApi.query({
   *     query: someQuery,
   *     variables: someVariables,
   *   }),
   *   Cache.key('MyType', someCacheKey, someOtherCacheKey),
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
    const shouldCache = this.enabled === true
    if (!shouldCache) {
      this.log?.logDisabled()
      return resource()
    }

    this.log?.startLogTime(key)
    const result = await this.#cacheable(resource, key, timeout)
    this.log?.stopLogTime(key)

    return result
  }

  async #cacheable<T>(
    resource: () => Promise<T>,
    key: string,
    timeout?: number,
  ): Promise<T> {
    const storedResource = this.cache[key]

    if (storedResource === undefined) {
      const value = await resource()
      this.cache[key] = {
        value,
        hits: 0,
        misses: 1,
        timer: timeout
          ? setTimeout(() => {
              this.clearValue(key)
            }, timeout)
          : undefined,
      }
      this.log?.logNewCacheable(key)
      return value
    }

    const hasRetrievedValue = storedResource.value !== undefined
    if (hasRetrievedValue) {
      storedResource.hits += 1
      this.log?.logCacheHit(key, storedResource.hits)
      return storedResource.value as T
    } else {
      const value = await resource()
      this.clearTimeout(key)
      if (timeout) {
        storedResource.timer = setTimeout(() => {
          this.clearValue(key)
        }, timeout)
      }
      storedResource.value = value
      storedResource.misses += 1
      this.log?.logCacheMiss(key, storedResource.misses)
      return value
    }
  }
}

class Logger {
  constructor(private logTiming: boolean) {}
  startLogTime(key: string): void {
    if (this.logTiming) {
      // eslint-disable-next-line no-console
      console.time(key)
    }
  }

  stopLogTime(key: string): void {
    if (this.logTiming) {
      // eslint-disable-next-line no-console
      console.timeEnd(key)
    }
  }

  logDisabled(): void {
    // eslint-disable-next-line no-console
    console.log('CACHE: Caching disabled')
  }

  logCacheHit(key: string, hits: number): void {
    // eslint-disable-next-line no-console
    console.log(`CACHE HIT: "${key}" found, hits: ${hits}.`)
  }

  logCacheMiss(key: string, misses: number): void {
    // eslint-disable-next-line no-console
    console.log(`CACHE MISS: "${key}" has no value, misses: ${misses}.`)
  }

  logNewCacheable(key: string): void {
    // eslint-disable-next-line no-console
    console.log(`CACHE MISS: "${key}" not in cache yet, caching.`)
  }

  logInvalidatingCache(key: string): void {
    // eslint-disable-next-line no-console
    console.log(`CACHE INVALIDATED: "${key}" invalidated.`)
  }
}
