import { Cacheable, MemoryBucket } from '../src'

const mockedApiRequest = <T>(value: T, duration = 0): Promise<T> =>
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
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'cache-only',
    })

    const co = (v: any) => cache.remember(() => mockedApiRequest(v), 'key')

    const a = await co(0)
    const b = await co(1)
    const c = await co(2)

    expect(a).toEqual(0)
    expect(b).toEqual(0)
    expect(c).toEqual(0)
  })

  it('network-only-non-concurrent', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'network-only-non-concurrent',
    })

    const nonc = (v: any) =>
      cache.remember(() => mockedApiRequest(v, 50), 'key')

    // Preheat cache
    await nonc(-1)

    const a = nonc(0)
    const b = nonc(1)
    const c = nonc(2)

    await wait(100)

    const d = nonc(3)

    const values = await Promise.all([a, b, c, d])

    expect(values).toEqual([0, 0, 0, 3])
  })
  it('network-only', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'network-only',
    })

    const no = (v: any) => cache.remember(() => mockedApiRequest(v, 50), 'key')

    // Preheat cache
    await no(-1)

    const a = no(0)
    const b = no(1)
    const c = no(2)

    const values = await Promise.all([a, b, c])

    expect(values).toEqual([0, 1, 2])
  })
  it('max-age', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'max-age',
      maxAge: 100,
    })

    const ma = (v: any) => cache.remember(() => mockedApiRequest(v, 50), 'key')

    const a = await ma(0)
    const b = await ma(1)

    // Wait well past maxAge so the staleness check isn't on the boundary.
    await wait(300)

    const c = await ma(2)
    const d = await ma(3)

    expect([a, b, c, d]).toEqual([0, 0, 2, 2])
  })
  it('stale-while-revalidate', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'stale-while-revalidate',
    })

    const swr = (v: any) => cache.remember(() => mockedApiRequest(v, 50), 'key')

    // Preheat cache
    await swr(-1)

    await wait(100)

    const a = await swr(0)
    const b = await swr(1)
    const c = await swr(2)

    await wait(100)

    const d = await swr(3)
    const e = await swr(4)
    const f = await swr(5)

    expect([a, b, c, d, e, f]).toEqual([-1, -1, -1, 0, 0, 0])
  })

  it('stale-while-revalidate with maxAge', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'stale-while-revalidate',
      maxAge: 200,
    })

    const swr = (v: any) => cache.remember(() => mockedApiRequest(v, 50), 'key')

    // Preheat cache, fetcher takes ~50ms.
    await swr(0)

    // Still well within maxAge.
    await wait(50)
    const a = await swr(1)

    // Wait clearly past maxAge so the entry is unambiguously stale.
    await wait(400)

    // Stale read: returns the cached value and kicks off a background refetch.
    const b = await swr(2)

    // Give the background refetch (~50ms) plenty of time to land.
    await wait(150)

    // Cache has been silently updated to 2 and is fresh again.
    const c = await swr(3)

    expect([a, b, c]).toEqual([0, 0, 2])
  })
})
