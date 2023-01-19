//region Types
export type CacheOptions = {
  /**
   * Enables caching
   */
  enabled?: boolean
  /**
   * Enable/disable logging of cache hits
   */
  log?: boolean
  /**
   * Enable/disable timings
   */
  logTiming?: boolean
}

type CacheOnlyCachePolicy = {
  cachePolicy: 'cache-only'
}

type NetworkOnlyNonConcurrentCachePolicy = {
  cachePolicy: 'network-only-non-concurrent'
}

type NetworkOnlyCachePolicy = {
  cachePolicy: 'network-only'
}

type MaxAgeCachePolicy = {
  cachePolicy: 'max-age'
  maxAge: number
}

type SWRCachePolicy = {
  cachePolicy: 'stale-while-revalidate'
  maxAge?: number
}

/**
 * Cacheable options.
 */
export type CacheableOptions =
  | CacheOnlyCachePolicy
  | NetworkOnlyCachePolicy
  | NetworkOnlyNonConcurrentCachePolicy
  | MaxAgeCachePolicy
  | SWRCachePolicy

//endregion

//region Cacheables
/**
 * Provides a simple in-memory cache with automatic or manual invalidation.
 */
export class Cacheables {
  enabled: boolean
  log: boolean
  logTiming: boolean

  constructor(options?: CacheOptions) {
    this.enabled = options?.enabled ?? true
    this.log = options?.log ?? false
    this.logTiming = options?.logTiming ?? false
  }

  #cacheables: Record<string, Cacheable<any>> = {}

  /**
   * Builds a key with the provided strings or numbers.
   * @param args
   */
  static key(...args: (string | number)[]): string {
    return args.join(':')
  }

  /**
   * Deletes a cacheable.
   * @param key
   */
  delete(key: string): void {
    delete this.#cacheables[key]
  }

  /**
   * Clears the cache by deleting all cacheables.
   */
  clear(): void {
    this.#cacheables = {}
  }

  /**
   * Returns whether a cacheable is present and valid (i.e., did not time out).
   */
  isCached(key: string): boolean {
    return !!this.#cacheables[key]
  }

  /**
   * Returns all the cache keys
   */
  keys(): string[] {
    return Object.keys(this.#cacheables)
  }

  /**
   * A "cacheable" represents a resource, commonly fetched from a remote source
   * that you want to cache for a certain period of time.
   * @param resource A function returning a Promise
   * @param key A key to identify the cache
   * @param options {CacheableOptions} options
   * @example
   * const apiResponse = await cache.cacheable(
   *   () => api.query({
   *     query: someQuery,
   *     variables: someVariables,
   *   }),
   *   Cache.key('type', someCacheKey, someOtherCacheKey),
   *   60000
   * )
   * @returns promise Resolves to the value of the provided resource, either from
   * cache or from the remote resource itself.
   */
  async cacheable<T>(
    resource: () => Promise<T>,
    key: string,
    options?: CacheableOptions,
  ): Promise<T> {
    const shouldCache = this.enabled
    if (!shouldCache) {
      if (this.log) Logger.logDisabled()
      return resource()
    }

    // Persist log settings as this could be a race condition
    const { logTiming, log } = this
    const logId = Logger.getLogId(key)
    if (logTiming) Logger.logTime(logId)

    const result = await this.#cacheable(resource, key, options)

    if (logTiming) Logger.logTimeEnd(logId)
    if (log) Logger.logStats(key, this.#cacheables[key])

    return result
  }

  #cacheable<T>(
    resource: () => Promise<T>,
    key: string,
    options?: CacheableOptions,
  ): Promise<T> {
    let cacheable = this.#cacheables[key] as Cacheable<T> | undefined

    if (!cacheable) {
      cacheable = new Cacheable()
      this.#cacheables[key] = cacheable
    }

    return cacheable.touch(resource, options)
  }
}
//endregion

//region Cacheable
/**
 * Helper class, can only be instantiated by calling its static
 * function `create`.
 */
class Cacheable<T> {
  hits = 0
  #lastFetch = 0
  #initialized = false
  #promise: Promise<T> | undefined

  get #isFetching() {
    return !!this.#promise
  }

  #value: T = undefined as unknown as T

  #logHit() {
    this.hits += 1
  }

  async #fetch(resource: () => Promise<T>): Promise<T> {
    this.#lastFetch = Date.now()
    this.#promise = resource()
    try {
      this.#value = await this.#promise
      if (!this.#initialized) this.#initialized = true
    } finally {
      this.#promise = undefined
    }
    return this.#value
  }

  async #fetchNonConcurrent(resource: () => Promise<T>): Promise<T> {
    if (this.#isFetching) {
      await this.#promise
      this.#logHit()
      return this.#value
    }
    return this.#fetch(resource)
  }

  #handlePreInit(
    resource: () => Promise<T>,
    options?: CacheableOptions,
  ): Promise<T> {
    if (!options) return this.#fetchNonConcurrent(resource)
    switch (options.cachePolicy) {
      case 'cache-only':
        return this.#fetchNonConcurrent(resource)
      case 'network-only':
        return this.#fetch(resource)
      case 'stale-while-revalidate':
        return this.#fetchNonConcurrent(resource)
      case 'max-age':
        return this.#fetchNonConcurrent(resource)
      case 'network-only-non-concurrent':
        return this.#fetchNonConcurrent(resource)
    }
  }

  #handleCacheOnly(): T {
    this.#logHit()
    return this.#value
  }

  #handleNetworkOnly(resource: () => Promise<T>): Promise<T> {
    return this.#fetch(resource)
  }

  #handleNetworkOnlyNonConcurrent(resource: () => Promise<T>): Promise<T> {
    return this.#fetchNonConcurrent(resource)
  }

  #handleMaxAge(resource: () => Promise<T>, maxAge: number) {
    if (Date.now() > this.#lastFetch + maxAge) {
      return this.#fetchNonConcurrent(resource)
    }
    this.#logHit()
    return this.#value
  }

  #handleSwr(resource: () => Promise<T>, maxAge?: number): T {
    if (
      !this.#isFetching &&
      ((maxAge && Date.now() > this.#lastFetch + maxAge) || !maxAge)
    ) {
      this.#fetchNonConcurrent(resource)
    }
    this.#logHit()
    return this.#value
  }

  /**
   * Get and set the value of the Cacheable.
   * Some tricky race are conditions going on here,
   * but this should behave as expected
   * @param resource
   * @param options {CacheableOptions}
   */
  async touch(
    resource: () => Promise<T>,
    options?: CacheableOptions,
  ): Promise<T> {
    if (!this.#initialized) {
      return this.#handlePreInit(resource, options)
    }
    if (!options) {
      return this.#handleCacheOnly()
    }
    switch (options.cachePolicy) {
      case 'cache-only':
        return this.#handleCacheOnly()
      case 'network-only':
        return this.#handleNetworkOnly(resource)
      case 'stale-while-revalidate':
        return this.#handleSwr(resource, options.maxAge)
      case 'max-age':
        return this.#handleMaxAge(resource, options.maxAge)
      case 'network-only-non-concurrent':
        return this.#handleNetworkOnlyNonConcurrent(resource)
    }
  }
}
//endregion

//region Logger
/**
 * Logger class with static logging functions.
 */
class Logger {
  static getLogId(key: string) {
    return key + '---' + Math.random().toString(36).substr(2, 9)
  }

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
    const { hits } = cacheable
    console.log(`Cacheable "${key}": hits: ${hits}`)
  }
}
//endregion
