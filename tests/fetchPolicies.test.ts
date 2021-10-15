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
    const cache = new Cacheables()

    const COCacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v), 'key', {
        cachePolicy: 'cache-only',
      })

    const a = await COCacheable(0)
    const b = await COCacheable(1)
    const c = await COCacheable(2)

    expect(a).toEqual(0)
    expect(b).toEqual(0)
    expect(c).toEqual(0)
  })

  it('network-only-non-concurrent', async () => {
    const cache = new Cacheables()

    const NONCCacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'key', {
        cachePolicy: 'network-only-non-concurrent',
      })

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
    const cache = new Cacheables()

    const NOCacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'key', {
        cachePolicy: 'network-only',
      })

    // Preheat cache
    await NOCacheable(-1)

    const a = NOCacheable(0)
    const b = NOCacheable(1)
    const c = NOCacheable(2)

    const values = await Promise.all([a, b, c])

    expect(values).toEqual([0, 1, 2])
  })
  it('max-age', async () => {
    const cache = new Cacheables()

    const MACacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'key', {
        cachePolicy: 'max-age',
        maxAge: 100,
      })

    const a = await MACacheable(0)
    const b = await MACacheable(1)

    await wait(100)

    const c = await MACacheable(2)
    const d = await MACacheable(3)

    expect([a, b, c, d]).toEqual([0, 0, 2, 2])
  })
  it('stale-while-revalidate', async () => {
    const cache = new Cacheables()

    const SWRCacheable = (v: any) =>
      cache.cacheable(() => mockedApiRequest(v, 50), 'key', {
        cachePolicy: 'stale-while-revalidate',
      })

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
})
