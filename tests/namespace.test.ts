import { Cacheable, MemoryBucket } from '../src'

describe('namespace', () => {
  it('isolates entries between two instances sharing one bucket', async () => {
    const bucket = new MemoryBucket()
    const a = new Cacheable('a', { buckets: [bucket] })
    const b = new Cacheable('b', { buckets: [bucket] })

    await a.remember(async () => 'A', 'k')
    await b.remember(async () => 'B', 'k')

    expect(await a.remember(async () => 'fresh', 'k')).toBe('A')
    expect(await b.remember(async () => 'fresh', 'k')).toBe('B')
  })

  it('writes bucket keys with namespace prefix', async () => {
    const bucket = new MemoryBucket()
    const a = new Cacheable('tenant1', { buckets: [bucket] })

    await a.remember(async () => 'v', 'user:42')

    expect(await bucket.read('tenant1:user:42')).toEqual({ value: 'v' })
    expect(await bucket.read('user:42')).toBeUndefined()
  })

  it('delete on one namespace does not affect another', async () => {
    const bucket = new MemoryBucket()
    const a = new Cacheable('a', { buckets: [bucket] })
    const b = new Cacheable('b', { buckets: [bucket] })

    await a.remember(async () => 'A', 'k')
    await b.remember(async () => 'B', 'k')

    await a.delete('k')

    expect(await a.meta('k')).toBeUndefined()
    expect(await b.meta('k')).toBeDefined()
  })

  it('clear from one namespace wipes shared bucket (documented caveat)', async () => {
    const bucket = new MemoryBucket()
    const a = new Cacheable('a', { buckets: [bucket] })
    const b = new Cacheable('b', { buckets: [bucket] })

    await a.remember(async () => 'A', 'k')
    await b.remember(async () => 'B', 'k')

    await a.clear()

    expect(await a.meta('k')).toBeUndefined()
    expect(await b.meta('k')).toBeUndefined()
  })
})
