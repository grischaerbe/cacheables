import { Cacheable, ConsoleLogger, MemoryBucket } from '../src'

const errorMessage = 'This is an error message.'

const mockedApiRequest = <T>(
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
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
    })
    const value = 10
    const cachedValue = await cache.remember(() => mockedApiRequest(value), 'a')
    expect(await cache.meta('a')).toBeDefined()
    expect(cachedValue).toEqual(value)
  })

  it('Stores multiple caches', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
    })

    const valueA = 10
    const valueB = 20

    const cachedValueA = await cache.remember(
      () => mockedApiRequest(valueA),
      'a',
    )
    const cachedValueB = await cache.remember(
      () => mockedApiRequest(valueB),
      'b',
    )

    expect(await cache.meta('a')).toBeDefined()
    expect(await cache.meta('b')).toBeDefined()
    expect([cachedValueA, cachedValueB]).toEqual([valueA, valueB])
  })

  it('Deletes values', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
    })

    const value = 10
    await cache.remember(() => mockedApiRequest(value), 'a')

    expect(await cache.meta('a')).toBeDefined()
    await cache.delete('a')
    expect(await cache.meta('a')).toBeUndefined()
  })

  it('Clears the cache', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
    })

    const value = 10
    await cache.remember(() => mockedApiRequest(value), 'a')

    expect(await cache.meta('a')).toBeDefined()
    await cache.clear()
    expect(await cache.meta('a')).toBeUndefined()
  })

  it('Creates proper keys', () => {
    const key = Cacheable.key('aaa', 'bbb', 'ccc', 'ddd', 10, 20)
    expect(key).toEqual('aaa:bbb:ccc:ddd:10:20')
  })

  it('Logs correctly', async () => {
    console.log = jest.fn()

    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      logger: new ConsoleLogger(),
    })

    const cachedRequest = () => cache.remember(() => mockedApiRequest(1), 'a')

    await cachedRequest()
    expect(console.log).lastCalledWith(
      expect.stringMatching(/^Cacheable "a": MISS \d+(\.\d+)?ms$/),
    )

    await cachedRequest()
    expect(console.log).lastCalledWith(
      expect.stringMatching(/^Cacheable "a": HIT \d+(\.\d+)?ms$/),
    )

    await cachedRequest()
    expect(console.log).lastCalledWith(
      expect.stringMatching(/^Cacheable "a": HIT \d+(\.\d+)?ms$/),
    )
  })

  it('Throws when constructed without buckets', () => {
    expect(() => new Cacheable('test', { buckets: [] })).toThrow(
      'At least one bucket is required',
    )
  })

  /**
   * Prepare for some weird timings here.
   * IMPORTANT: Be aware that the maxAge for a cache
   * is set **before** resolving the resource.
   *
   * Assuming the time starts at 0
   */
  it('Handles race conditions correctly', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'max-age',
      maxAge: 100,
    })

    const racingCache = (v: any) =>
      cache.remember(() => mockedApiRequest(v, 50), 'a')

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

    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      logger: new ConsoleLogger(),
      policy: 'max-age',
      maxAge: 100,
    })

    const hitCache = async () => {
      await cache.remember(() => mockedApiRequest(0, 10), 'a')
    }

    // This should be a miss and take ~10ms
    await hitCache()
    expect(console.log).lastCalledWith(
      expect.stringMatching(/^Cacheable "a": MISS \d+(\.\d+)?ms$/),
    )

    // This should be a hit and take ~0ms
    await hitCache()
    expect(console.log).lastCalledWith(
      expect.stringMatching(/^Cacheable "a": HIT \d+(\.\d+)?ms$/),
    )

    await wait(60)

    // This should be a hit and take ~0ms
    await hitCache()
    expect(console.log).lastCalledWith(
      expect.stringMatching(/^Cacheable "a": HIT \d+(\.\d+)?ms$/),
    )

    await wait(60)

    // This should be a miss and take ~10ms
    await hitCache()
    expect(console.log).lastCalledWith(
      expect.stringMatching(/^Cacheable "a": MISS \d+(\.\d+)?ms$/),
    )
  })

  it("Doesn't interfere with error handling", async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
    })
    const rejecting = () => {
      return cache.remember(() => mockedApiRequest(0, 10, true), 'a')
    }
    await expect(rejecting).rejects.toEqual(errorMessage)
  })

  it("Doesn't cache rejected value", async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
    })
    let errNo = 1
    const rejecting = () => {
      return cache.remember(() => Promise.reject(errNo++), 'a')
    }
    await expect(rejecting()).rejects.toEqual(1)
    await expect(rejecting()).rejects.toEqual(2)
  })
})
