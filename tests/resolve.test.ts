import { Cacheable, MemoryBucket } from '../src'
import type { IBaseMeta, IBucket } from '../src'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('resolve', () => {
  it('cache-only: hit returns cached meta; miss writes fresh meta', async () => {
    const cache = new Cacheable('test', { buckets: [new MemoryBucket()] })

    const before = Date.now()
    const a = await cache.resolve(async () => 'v', 'k')
    const after = Date.now()

    expect(a.storedAt).toBeGreaterThanOrEqual(before)
    expect(a.storedAt).toBeLessThanOrEqual(after)

    await wait(10)
    const b = await cache.resolve(async () => 'v2', 'k')
    expect(b.storedAt).toBe(a.storedAt)
  })

  it('network-only: every call writes fresh meta', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'network-only',
    })

    const a = await cache.resolve(async () => 'v', 'k')
    await wait(10)
    const b = await cache.resolve(async () => 'v', 'k')
    expect(b.storedAt).toBeGreaterThan(a.storedAt)
  })

  it('network-only-non-concurrent: every serial call writes fresh meta', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'network-only-non-concurrent',
    })

    const a = await cache.resolve(async () => 'v', 'k')
    await wait(10)
    const b = await cache.resolve(async () => 'v', 'k')
    expect(b.storedAt).toBeGreaterThan(a.storedAt)
  })

  it('max-age: meta is stable within window, refreshes when expired', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'max-age',
      maxAge: 100,
    })

    const a = await cache.resolve(async () => 'v', 'k')
    const b = await cache.resolve(async () => 'v', 'k')
    expect(b.storedAt).toBe(a.storedAt)

    await wait(200)
    const c = await cache.resolve(async () => 'v', 'k')
    expect(c.storedAt).toBeGreaterThan(a.storedAt)
  })

  it('SWR: returns stale meta immediately, background revalidation updates it', async () => {
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      policy: 'stale-while-revalidate',
      maxAge: 50,
    })

    const a = await cache.resolve(async () => 'v', 'k')
    await wait(150)

    // Stale: returns cached meta immediately and kicks off a background refetch.
    const b = await cache.resolve(async () => 'v', 'k')
    expect(b.storedAt).toBe(a.storedAt)

    // Give the background refetch plenty of time to land.
    await wait(150)

    const c = await cache.resolve(async () => 'v', 'k')
    expect(c.storedAt).toBeGreaterThan(a.storedAt)
  })

  it('concurrent remember + resolve share one producer call and one storedAt', async () => {
    const cache = new Cacheable('test', { buckets: [new MemoryBucket()] })

    let calls = 0
    const slow = async () => {
      calls += 1
      await wait(20)
      return 'v'
    }

    const [value, meta] = await Promise.all([
      cache.remember(slow, 'k'),
      cache.resolve(slow, 'k'),
    ])

    expect(calls).toBe(1)
    expect(value).toBe('v')

    const peeked = await cache.meta('k')
    expect(peeked?.storedAt).toBe(meta.storedAt)
  })

  it('resolve-returned meta matches cache.meta on fresh entries', async () => {
    const cache = new Cacheable('test', { buckets: [new MemoryBucket()] })
    const meta = await cache.resolve(async () => 'v', 'k')
    const peeked = await cache.meta('k')
    expect(peeked).toEqual(meta)
  })

  it('logs HIT/MISS with elapsed time, same shape as remember', async () => {
    const log = jest.fn()
    const cache = new Cacheable('test', {
      buckets: [new MemoryBucket()],
      logger: { log },
    })

    await cache.resolve(async () => 'v', 'k')
    expect(log).lastCalledWith(
      expect.stringMatching(/^Cacheable "k": MISS \d+(\.\d+)?ms$/),
    )

    await cache.resolve(async () => 'v', 'k')
    expect(log).lastCalledWith(
      expect.stringMatching(/^Cacheable "k": HIT \d+(\.\d+)?ms$/),
    )
  })

  describe('cascade', () => {
    interface WriteCall {
      key: string
      value: unknown
      meta: IBaseMeta | undefined
    }

    class FakeBucket implements IBucket<IBaseMeta> {
      store = new Map<string, { value: unknown; meta: IBaseMeta }>()
      writeCalls: WriteCall[] = []

      constructor(seed?: { key: string; value: unknown; meta: IBaseMeta }) {
        if (seed)
          this.store.set(seed.key, { value: seed.value, meta: seed.meta })
      }

      async read<T>(key: string): Promise<{ value: T } | undefined> {
        const entry = this.store.get(key)
        return entry === undefined ? undefined : { value: entry.value as T }
      }

      async write<T>(key: string, value: T, meta?: IBaseMeta): Promise<void> {
        this.writeCalls.push({ key, value, meta })
        this.store.set(key, { value, meta: meta ?? { storedAt: Date.now() } })
      }

      async meta(key: string): Promise<IBaseMeta | undefined> {
        return this.store.get(key)?.meta
      }

      async delete(key: string): Promise<void> {
        this.store.delete(key)
      }

      async clear(): Promise<void> {
        this.store.clear()
      }
    }

    it('L1 miss + L2 hit: resolve returns the L2 meta (storedAt preserved)', async () => {
      const l2Meta: IBaseMeta = { storedAt: 12345 }
      const l1 = new FakeBucket()
      const l2 = new FakeBucket({ key: 'test:k', value: 'v', meta: l2Meta })
      const cache = new Cacheable('test', { buckets: [l1, l2] })

      const meta = await cache.resolve(async () => 'fresh', 'k')
      expect(meta.storedAt).toBe(12345)
    })

    it('both miss: resolve returns L1 meta after write; storedAt agrees with what L2 received', async () => {
      const l1 = new FakeBucket()
      const l2 = new FakeBucket()
      const cache = new Cacheable('test', { buckets: [l1, l2] })

      const meta = await cache.resolve(async () => 'fresh', 'k')

      expect(l2.writeCalls.length).toBe(1)
      expect(l2.writeCalls[0]!.meta?.storedAt).toBe(meta.storedAt)
    })
  })
})
