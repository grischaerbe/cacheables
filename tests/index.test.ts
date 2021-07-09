import { Cacheables } from '../src'

const mockedApiRequest = (
  shouldResolve: boolean,
  value: number | string,
  duration = 0,
) =>
  new Promise((resolve, reject) => {
    if (shouldResolve) {
      if (duration > 0) {
        setTimeout(() => {
          resolve(value)
        }, duration)
      } else {
        resolve(value)
      }
    } else {
      reject()
    }
  })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Cache operations', () => {
  it('Returns correct values', async () => {
    const cache = new Cacheables()
    const value = 10
    const cachedValue = await cache.cacheable(
      () => mockedApiRequest(true, value),
      'a',
    )
    expect(cache.isCached('a')).toEqual(true)
    expect(cache.keys()).toEqual(['a'])
    expect(cachedValue).toEqual(value)
  })

  it('Invalidates correctly', async () => {
    const cache = new Cacheables()

    await cache.cacheable(() => mockedApiRequest(true, 10, 50), 'a', 100)

    expect(cache.isCached('a')).toEqual(true)
    await wait(150)
    expect(cache.isCached('a')).toEqual(false)
    expect(cache.keys()).toEqual(['a'])
  })

  it('Stores multiple caches', async () => {
    const cache = new Cacheables()

    const valueA = 10
    const valueB = 20

    const cachedValueA = await cache.cacheable(
      () => mockedApiRequest(true, valueA),
      'a',
    )
    const cachedValueB = await cache.cacheable(
      () => mockedApiRequest(true, valueB),
      'b',
    )

    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
    expect([cachedValueA, cachedValueB]).toEqual([valueA, valueB])
  })

  it('Invalidates the correct value', async () => {
    const cache = new Cacheables()

    const valueA = 10
    await cache.cacheable(() => mockedApiRequest(true, valueA), 'a', 100)
    const valueB = 20
    await cache.cacheable(() => mockedApiRequest(true, valueB), 'b', 200)

    expect(cache.isCached('a')).toEqual(true)
    expect(cache.isCached('b')).toEqual(true)
    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
    await wait(150)
    expect(cache.isCached('a')).toEqual(false)
    expect(cache.isCached('b')).toEqual(true)
    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
    await wait(250)
    expect(cache.isCached('a')).toEqual(false)
    expect(cache.isCached('b')).toEqual(false)
    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
  })

  it('Deletes values', async () => {
    const cache = new Cacheables()

    const value = 10
    await cache.cacheable(() => mockedApiRequest(true, value), 'a')

    expect(cache.isCached('a')).toEqual(true)
    cache.delete('a')
    expect(cache.isCached('a')).toEqual(false)
  })

  it('Clears the cache', async () => {
    const cache = new Cacheables()

    const value = 10
    await cache.cacheable(() => mockedApiRequest(true, value), 'a')

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
      () => mockedApiRequest(true, value),
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
    await cache.cacheable(() => mockedApiRequest(true, 1), 'a')
    expect(console.log).lastCalledWith('CACHE: Caching disabled')
    cache.enabled = true

    await cache.cacheable(() => mockedApiRequest(true, 1), 'a')
    expect(console.log).lastCalledWith('Cacheable "a": hits: 0, misses: 1')

    await cache.cacheable(() => mockedApiRequest(true, 1), 'a', 50)
    expect(console.log).lastCalledWith('Cacheable "a": hits: 1, misses: 1')

    await wait(100)
    await cache.cacheable(() => mockedApiRequest(true, 1), 'a')
    expect(console.log).lastCalledWith('Cacheable "a": hits: 1, misses: 2')
  })

  /**
   * Prepare for some weird timings here.
   * IMPORTANT: Be aware that the timeout for a cache
   * is set **before** resolving the resource.
   *
   * Assuming the time starts at 0
   */
  it('Handles race conditions correctly', async () => {
    const cache = new Cacheables({
      logTiming: true,
    })

    // Create a cache that times out at 100 and resolves at 10
    const a = await cache.cacheable(
      () => mockedApiRequest(true, 'a', 10),
      'a',
      100,
    )
    expect(a).toEqual('a')

    // The time is ~10, the cache should not be invalidated yet, this should be a cache hit.
    // Nevertheless let the cache time out at 100.
    const b = await cache.cacheable(
      () => mockedApiRequest(true, 'b', 100),
      'a',
      100,
    )
    expect(b).toEqual('a')

    await wait(200)

    // The time is ~(10 + 200 = 210) and the cache should be invalidated.
    const c = await cache.cacheable(() => mockedApiRequest(true, 'c'), 'a')
    expect(c).toEqual('c')
  })
})
