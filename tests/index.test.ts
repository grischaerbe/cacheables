import { Cacheables } from '../src'

const errorMessage = 'This is an error message.'

const mockedApiRequest = (
  value: number | string,
  duration = 0,
  reject = false,
) =>
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

  it('Invalidates correctly', async () => {
    const cache = new Cacheables()

    await cache.cacheable(() => mockedApiRequest('someValue', 10), 'a')

    expect(cache.isCached('a', 100)).toEqual(true)
    await wait(150)
    expect(cache.isCached('a', 100)).toEqual(false)
    expect(cache.keys()).toEqual(['a'])
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

  it('Invalidates the correct value', async () => {
    const cache = new Cacheables()

    const cacheTimeoutA = 100
    const cacheTimeoutB = 200

    await cache.cacheable(() => mockedApiRequest('valueA'), 'a', cacheTimeoutA)
    await cache.cacheable(() => mockedApiRequest('valueB'), 'b', cacheTimeoutB)

    expect(cache.isCached('a', cacheTimeoutA)).toEqual(true)
    expect(cache.isCached('b', cacheTimeoutB)).toEqual(true)
    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
    await wait(150)
    expect(cache.isCached('a', cacheTimeoutA)).toEqual(false)
    expect(cache.isCached('b', cacheTimeoutB)).toEqual(true)
    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
    await wait(100)
    expect(cache.isCached('a', cacheTimeoutA)).toEqual(false)
    expect(cache.isCached('b', cacheTimeoutB)).toEqual(false)
    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
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

    await cache.cacheable(() => mockedApiRequest(1), 'a')
    expect(console.log).lastCalledWith('CACHE: Caching disabled')
    cache.enabled = true

    await cache.cacheable(() => mockedApiRequest(1), 'a')
    expect(console.log).lastCalledWith('Cacheable "a": hits: 0, misses: 0')

    await cache.cacheable(() => mockedApiRequest(1), 'a', 50)
    expect(console.log).lastCalledWith('Cacheable "a": hits: 1, misses: 0')

    await wait(100)
    await cache.cacheable(() => mockedApiRequest(1), 'a', 50)
    expect(console.log).lastCalledWith('Cacheable "a": hits: 1, misses: 1')
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

    // Create a cache that times out at 100 and resolves at 10
    const a = await cache.cacheable(() => mockedApiRequest(0, 10), 'a', 100)
    expect(a).toEqual(0)

    // The time is ~10, the cache should not be invalidated
    // yet, this should bea cache hit and should resolve value 'a'.
    // Nevertheless let the cache time out at 100.
    const b = await cache.cacheable(() => mockedApiRequest(1, 100), 'a', 100)
    expect(b).toEqual(0)

    await wait(200)

    // The time is ~(10 + 200 = 210) and the cache should be invalidated.
    const c = await cache.cacheable(() => mockedApiRequest(2), 'a', 100)
    expect(c).toEqual(2)
  })

  it('Handles multiple calls correctly', async () => {
    console.log = jest.fn()

    const cache = new Cacheables({
      log: true,
    })

    const hitCache = async () => {
      await cache.cacheable(() => mockedApiRequest(0, 10), 'a', 100)
    }

    // This should be a miss and take ~10ms
    await hitCache()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 0, misses: 0')

    // This should be a hit and take ~0ms
    await hitCache()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 1, misses: 0')

    await wait(60)

    // This should be a hit and take ~0ms
    await hitCache()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 2, misses: 0')

    await wait(60)

    // This should be a miss and take ~10ms
    await hitCache()
    expect(console.log).lastCalledWith('Cacheable "a": hits: 2, misses: 1')
  })

  it("Doesn't interfere with error handling", async () => {
    const cache = new Cacheables()
    const rejecting = () => {
      return cache.cacheable(() => mockedApiRequest(0, 10, true), 'a', 100)
    }
    await expect(rejecting).rejects.toEqual(errorMessage)
  })
})
