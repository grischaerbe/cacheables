import { Cacheables } from '../src'

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

describe('Fetch Policies', () => {
  it('cache-only', async () => {
    const cache = new Cacheables({ policy: 'cache-only' })

    const COCacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v), 'key')

    const a = await COCacheable(0)
    const b = await COCacheable(1)
    const c = await COCacheable(2)

    expect(a).toEqual(0)
    expect(b).toEqual(0)
    expect(c).toEqual(0)
  })

  it('network-only-non-concurrent', async () => {
    const cache = new Cacheables({ policy: 'network-only-non-concurrent' })

    const NONCCacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'key')

    // Preheat cache
    await NONCCacheable(-1)

    const a = NONCCacheable(0)
    const b = NONCCacheable(1)
    const c = NONCCacheable(2)

    await wait(100)

    const d = NONCCacheable(3)

    const values = await Promise.all([a, b, c, d])

    expect(values).toEqual([0, 0, 0, 3])
  })
  it('network-only', async () => {
    const cache = new Cacheables({ policy: 'network-only' })

    const NOCacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'key')

    // Preheat cache
    await NOCacheable(-1)

    const a = NOCacheable(0)
    const b = NOCacheable(1)
    const c = NOCacheable(2)

    const values = await Promise.all([a, b, c])

    expect(values).toEqual([0, 1, 2])
  })
  it('max-age', async () => {
    const cache = new Cacheables({ policy: 'max-age', maxAge: 100 })

    const MACacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'key')

    const a = await MACacheable(0)
    const b = await MACacheable(1)

    await wait(100)

    const c = await MACacheable(2)
    const d = await MACacheable(3)

    expect([a, b, c, d]).toEqual([0, 0, 2, 2])
  })
  it('stale-while-revalidate', async () => {
    const cache = new Cacheables({ policy: 'stale-while-revalidate' })

    const SWRCacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'key')

    // Preheat cache
    await SWRCacheable(-1)

    await wait(100)

    const a = await SWRCacheable(0)
    const b = await SWRCacheable(1)
    const c = await SWRCacheable(2)

    await wait(100)

    const d = await SWRCacheable(3)
    const e = await SWRCacheable(4)
    const f = await SWRCacheable(5)

    expect([a, b, c, d, e, f]).toEqual([-1, -1, -1, 0, 0, 0])
  })

  it('stale-while-revalidate with maxAge', async () => {
    const cache = new Cacheables({
      policy: 'stale-while-revalidate',
      maxAge: 200,
    })

    const SWRCacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'key')

    // Preheat cache, takes ~50ms
    await SWRCacheable(0)

    await wait(100)

    // ~150ms on the clock, maxAge not reached
    const a = await SWRCacheable(1)

    await wait(100)

    // ~250ms on the clock, maxAge reached, cache updates silently
    const b = await SWRCacheable(2)

    await wait(100)

    // ~350ms on the clock, cache should be updated silently with value `2`
    const c = await SWRCacheable(3)

    expect([a, b, c]).toEqual([0, 0, 2])
  })
})
