import { Cacheables } from '../src'
import { InMemoryCacheAdapter } from '../src/adapters/InMemoryCacheAdapter'
import { CacheAdapter } from '../src/adapters/CacheAdapter'

const mockedApiRequest = <T extends any>(value: T, duration = 0): Promise<T> =>
  new Promise((resolve) => {
    if (duration > 0) {
      setTimeout(() => {
        resolve(value)
      }, duration)
    } else {
      resolve(value)
    }
  })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class MockCacheAdapter extends CacheAdapter {
  cache: Record<string, any> = {}

  async has(key: string): Promise<boolean> {
    await wait(100)
    return !!this.cache[key]
  }

  async get(key: string): Promise<any> {
    await wait(100)
    return this.cache[key]
  }

  async put(key: string, value: any): Promise<void> {
    await wait(100)
    this.cache[key] = value
  }
}

describe('Cache Adapters', () => {
  it('Default InMemoryCacheAdapter', async () => {
    const cache = new Cacheables({
      adapter: new InMemoryCacheAdapter(),
    })

    const value = 10
    const cachedValue = await cache.cacheable(
      () => mockedApiRequest(value),
      'a',
    )

    expect(cache.isCached('a')).toEqual(true)
    expect(cache.keys()).toEqual(['a'])
    expect(cachedValue).toEqual(value)
  })

  it('Prepopulated InMemoryCacheAdapter', async () => {
    const cacheAdapter = new InMemoryCacheAdapter()
    const cache = new Cacheables({
      adapter: cacheAdapter,
    })

    const key = 'a'
    const prepopulatedValue = 1
    cacheAdapter.put(key, prepopulatedValue)

    const value = 10
    const cachedValue = await cache.cacheable(
      () => mockedApiRequest(value),
      'a',
      {
        cachePolicy: 'cache-only',
      },
    )

    expect(cache.isCached('a')).toEqual(true)
    expect(cache.keys()).toEqual(['a'])
    expect(cachedValue).toEqual(prepopulatedValue)
  })

  it('Async CacheAdapter Cache Policies', async () => {
    const cache = new Cacheables({
      adapter: new MockCacheAdapter(),
      logTiming: true,
    })

    /**
     * The MockCacheAdapter needs ~100ms to fetch from the
     * cache and put values to the cache, so the total runtime
     * of this request is ~100ms fetch + ~100ms cache put = ~200ms.
     */
    const valueA = 'a'
    const a = await cache.cacheable(() => mockedApiRequest(valueA, 100), 'a')
    expect(a).toEqual(valueA)

    /**
     * Max Age
     * With maxAge: 220ms, this should get the value from the cache.
     */
    const valueB = 'b'
    const b = await cache.cacheable(() => mockedApiRequest(valueB), 'a', {
      cachePolicy: 'max-age',
      maxAge: 250,
    })
    expect(b).toEqual(valueA)

    /**
     * Network Only
     */
    const valueC = 'c'
    const c = await cache.cacheable(() => mockedApiRequest(valueC), 'a', {
      cachePolicy: 'network-only',
    })
    expect(c).toEqual(valueC)

    /**
     * Cache Only
     */
    const valueD = 'd'
    const d = await cache.cacheable(() => mockedApiRequest(valueD), 'a', {
      cachePolicy: 'cache-only',
    })
    expect(d).toEqual(valueC)

    /**
     * State While Revalidate
     * As the CacheAdapter needs about 100ms to read/write, this request has a total runtime of 100ms
     */
    const valueE = 'e'
    const e = await cache.cacheable(() => mockedApiRequest(valueE), 'a', {
      cachePolicy: 'stale-while-revalidate',
    })
    expect(e).toEqual(valueC)

    await wait(150)

    /**
     * After 100ms, this request should hit the cache
     */
    const valueF = 'f'
    const f = await cache.cacheable(() => mockedApiRequest(valueF), 'a', {
      cachePolicy: 'stale-while-revalidate',
    })
    expect(f).toEqual(valueE)

    /**
     * Cache value: valueF
     */
    await wait(150)

    /**
     * Network Only Non Concurrent
     */
    const valueG = 'g'
    const g = cache.cacheable(() => mockedApiRequest(valueG), 'a', {
      cachePolicy: 'network-only-non-concurrent',
    })

    const valueH = 'h'
    const h = cache.cacheable(() => mockedApiRequest(valueH), 'a', {
      cachePolicy: 'network-only-non-concurrent',
    })

    const [resultG, resultH] = await Promise.all([g, h])
    expect(resultG).toEqual(valueG)
    expect(resultH).toEqual(valueG)
  })
})
