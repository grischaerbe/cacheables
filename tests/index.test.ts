import { CacheableOptions, Cacheables } from '../src'

const errorMessage = 'This is an error message.'

const mockedApiRequest = <T extends any>(
  value: T,
  duration = 0,
  reject = false,
): Promise<T> =>
  new Promise((resolve, r) => {
    if (reject) r(errorMessage)
    if (duration > 0) {
      setTimeout(() => {
        resolve(value)
      }, duration)
    } else {
      resolve(value)
    }
  })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Cache operations', () => {
  it('Returns correct values', async () => {
    const cache = new Cacheables()
    const value = 10
    const cachedValue = await cache.cacheable(
      () => mockedApiRequest(value),
      'a',
    )
    expect(cache.isCached('a')).toEqual(true)
    expect(cache.keys()).toEqual(['a'])
    expect(cachedValue).toEqual(value)
  })

  it('Stores multiple caches', async () => {
    const cache = new Cacheables()

    const valueA = 10
    const valueB = 20

    const cachedValueA = await cache.cacheable(
      () => mockedApiRequest(valueA),
      'a',
    )
    const cachedValueB = await cache.cacheable(
      () => mockedApiRequest(valueB),
      'b',
    )

    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
    expect([cachedValueA, cachedValueB]).toEqual([valueA, valueB])
  })

  it('Deletes values', async () => {
    const cache = new Cacheables()

    const value = 10
    await cache.cacheable(() => mockedApiRequest(value), 'a')

    expect(cache.isCached('a')).toEqual(true)
    cache.delete('a')
    expect(cache.isCached('a')).toEqual(false)
  })

  it('Clears the cache', async () => {
    const cache = new Cacheables()

    const value = 10
    await cache.cacheable(() => mockedApiRequest(value), 'a')

    expect(cache.isCached('a')).toEqual(true)
    cache.clear()
    expect(cache.isCached('a')).toEqual(false)
  })

  it('Creates proper keys', () => {
    const key = Cacheables.key('aaa', 'bbb', 'ccc', 'ddd', 10, 20)
    expect(key).toEqual('aaa:bbb:ccc:ddd:10:20')
  })

  it('Returns correctly if disabled', async () => {
    const cache = new Cacheables({
      enabled: false,
    })

    const value = 10
    const uncachedValue = await cache.cacheable(
      () => mockedApiRequest(value),
      'a',
    )

    expect(uncachedValue).toEqual(value)
  })

  it('Logs correctly', async () => {
    console.log = jest.fn()

    const cache = new Cacheables({
      log: true,
      enabled: false,
    })

    const cachedRequest = () => cache.cacheable(() => mockedApiRequest(1), 'a')

    await cachedRequest()
    expect(console.log).lastCalledWith('CACHE: Caching disabled')
    cache.enabled = true

    await cachedRequest()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 0')

    await cachedRequest()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 1')
  })

  /**
   * Prepare for some weird timings here.
   * IMPORTANT: Be aware that the maxAge for a cache
   * is set **before** resolving the resource.
   *
   * Assuming the time starts at 0
   */
  it('Handles race conditions correctly', async () => {
    const cache = new Cacheables()

    const racingCache = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'a', {
        cachePolicy: 'max-age',
        maxAge: 100,
      })

    // Create a cache that times out at 100 and resolves at 50
    const a = await racingCache('a')
    expect(a).toEqual('a')

    // The time is ~50, the cache should not be invalidated
    // yet, this should be a cache hit and should resolve value 'a' immediately.
    const b = await racingCache('b')
    expect(b).toEqual('a')

    // maxAge of previous requests expired
    await wait(200)

    // The time is ~(50 + 200 = 250) and the cache should be invalidated.
    const c = await racingCache('c')
    expect(c).toEqual('c')
  })

  it('Handles multiple calls correctly', async () => {
    console.log = jest.fn()

    const cache = new Cacheables({
      log: true,
    })

    const hitCache = async () => {
      await cache.cacheable(() => mockedApiRequest(0, 10), 'a', {
        cachePolicy: 'max-age',
        maxAge: 100,
      })
    }

    // This should be a miss and take ~10ms
    await hitCache()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 0')

    // This should be a hit and take ~0ms
    await hitCache()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 1')

    await wait(60)

    // This should be a hit and take ~0ms
    await hitCache()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 2')

    await wait(60)

    // This should be a miss and take ~10ms
    await hitCache()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 2')
  })

  it("Doesn't interfere with error handling", async () => {
    const cache = new Cacheables()
    const rejecting = () => {
      return cache.cacheable(() => mockedApiRequest(0, 10, true), 'a')
    }
    await expect(rejecting).rejects.toEqual(errorMessage)
  })

  it("Doesn't cache rejected value", async () => {
    const cache = new Cacheables()
    let errNo = 1
    const rejecting = () => {
      return cache.cacheable(() => Promise.reject(errNo++), 'a')
    }
    await expect(rejecting()).rejects.toEqual(1)
    await expect(rejecting()).rejects.toEqual(2)
  })
})
