export interface CacheOptions {
  enabled?: boolean
  log?: boolean
  logTiming?: boolean
}

/**
 * Provides a simple in-memory cache with automatic or manual invalidation.
 */
export class Cacheables {
  public log: boolean
  public enabled: boolean
  public logTiming: boolean

  constructor(options?: CacheOptions) {
    this.enabled = options?.enabled ?? true
    this.log = options?.log ?? false
    this.logTiming = options?.logTiming ?? false
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

  // region logs
  private startLogTime(key: string): void {
    if (this.logTiming) {
      // eslint-disable-next-line no-console
      console.time(key)
    }
  }

  private stopLogTime(key: string): void {
    if (this.logTiming) {
      // eslint-disable-next-line no-console
      console.timeEnd(key)
    }
  }

  private logDisabled(): void {
    if (this.log) {
      // eslint-disable-next-line no-console
      console.log('CACHE: Caching disabled')
    }
  }

  private logCacheHit(key: string, hits: number): void {
    if (this.log) {
      // eslint-disable-next-line no-console
      console.log(`CACHE HIT: "${key}" found, hits: ${hits}.`)
    }
  }

  private logCacheMiss(key: string, misses: number): void {
    if (this.log) {
      // eslint-disable-next-line no-console
      console.log(`CACHE MISS: "${key}" has no value, misses: ${misses}.`)
    }
  }

  private logNewCacheable(key: string): void {
    if (this.log) {
      // eslint-disable-next-line no-console
      console.log(`CACHE MISS: "${key}" not in cache yet, caching.`)
    }
  }

  private logInvalidatingCache(key: string): void {
    if (this.log) {
      // eslint-disable-next-line no-console
      console.log(`CACHE INVALIDATED: "${key}" invalidated.`)
    }
  }
  // endregion

  private clearValue(key: string): void {
    if (this.cache[key] && this.cache[key].value) {
      delete this.cache[key].value
      this.logInvalidatingCache(key)
    }
  }

  private clearTimeout(key: string): void {
    if (this.cache[key] && this.cache[key].timer) {
      clearTimeout(this.cache[key].timer as ReturnType<typeof setTimeout>)
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
    if (!this.enabled) {
      this.logDisabled()
      return resource()
    }
    this.startLogTime(key)
    if (this.cache[key] && this.cache[key].value) {
      this.cache[key].hits += 1
      this.logCacheHit(key, this.cache[key].hits)
      this.stopLogTime(key)
      return this.cache[key].value as T
    } else {
      const value = await resource()
      if (this.cache[key] && !this.cache[key].value) {
        this.clearTimeout(key)
        if (timeout) {
          this.cache[key].timer = setTimeout(() => {
            this.clearValue(key)
          }, timeout)
        }
        this.cache[key].value = value
        this.cache[key].misses += 1
        this.logCacheMiss(key, this.cache[key].misses)
        this.stopLogTime(key)
        return value
      } else {
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
        this.logNewCacheable(key)
        this.stopLogTime(key)
        return value
      }
    }
  }
}