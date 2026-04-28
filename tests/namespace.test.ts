import { Cacheable, MemoryBucket } from '../src'

describe('namespace', () => {
  it('isolates entries between two instances sharing one bucket', async () => {
    const bucket = new MemoryBucket()
    const a = new Cacheable({ buckets: [bucket], namespace: 'a' })
    const b = new Cacheable({ buckets: [bucket], namespace: 'b' })

    await a.remember(async () => 'A', 'k')
    await b.remember(async () => 'B', 'k')

    expect(await a.remember(async () => 'fresh', 'k')).toBe('A')
    expect(await b.remember(async () => 'fresh', 'k')).toBe('B')
  })

  it('writes bucket keys with namespace prefix', async () => {
    const bucket = new MemoryBucket()
    const a = new Cacheable({ buckets: [bucket], namespace: 'tenant1' })

    await a.remember(async () => 'v', 'user:42')

    expect(await bucket.read('tenant1:user:42')).toEqual({ value: 'v' })
    expect(await bucket.read('user:42')).toBeUndefined()
  })

  it('delete on one namespace does not affect another', async () => {
    const bucket = new MemoryBucket()
    const a = new Cacheable({ buckets: [bucket], namespace: 'a' })
    const b = new Cacheable({ buckets: [bucket], namespace: 'b' })

    await a.remember(async () => 'A', 'k')
    await b.remember(async () => 'B', 'k')

    await a.delete('k')

    expect(await a.isCached('k')).toBe(false)
    expect(await b.isCached('k')).toBe(true)
  })

  it('clear from one namespace wipes shared bucket (documented caveat)', async () => {
    const bucket = new MemoryBucket()
    const a = new Cacheable({ buckets: [bucket], namespace: 'a' })
    const b = new Cacheable({ buckets: [bucket], namespace: 'b' })

    await a.remember(async () => 'A', 'k')
    await b.remember(async () => 'B', 'k')

    await a.clear()

    expect(await a.isCached('k')).toBe(false)
    expect(await b.isCached('k')).toBe(false)
  })

  it('omitting namespace stores keys verbatim', async () => {
    const bucket = new MemoryBucket()
    const cache = new Cacheable({ buckets: [bucket] })
    await cache.remember(async () => 'v', 'k')
    expect(await bucket.read('k')).toEqual({ value: 'v' })
  })
})
