import { Cacheable, MemoryBucket } from '../src'
import type { BucketEntryMeta, IBucket } from '../src'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface UrlView {
  url: string
}

class FakeViewBucket implements IBucket<UrlView> {
  store = new Map<string, { value: unknown; meta: BucketEntryMeta }>()

  readCalls = 0
  viewCalls = 0

  constructor(seed?: { key: string; value: unknown; meta: BucketEntryMeta }) {
    if (seed) this.store.set(seed.key, { value: seed.value, meta: seed.meta })
  }

  async read<T>(key: string): Promise<{ value: T } | undefined> {
    this.readCalls += 1
    const entry = this.store.get(key)
    return entry === undefined ? undefined : { value: entry.value as T }
  }

  async write<T>(key: string, value: T, meta: BucketEntryMeta): Promise<void> {
    this.store.set(key, { value, meta })
  }

  async meta(key: string): Promise<BucketEntryMeta | undefined> {
    return this.store.get(key)?.meta
  }

  async view(key: string): Promise<{ view: UrlView } | undefined> {
    this.viewCalls += 1
    return this.store.has(key) ? { view: { url: `fake://${key}` } } : undefined
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    this.store.clear()
  }
}

describe('cache.resolve(): TView round-trip', () => {
  it('miss: producer runs, cascade writes, resolve returns L1 view', async () => {
    const l1 = new FakeViewBucket()
    const cache = new Cacheable<UrlView>('test', { buckets: [l1] })

    const view = await cache.resolve(async () => 'fresh', 'k')
    expect(view).toEqual({ url: 'fake://test:k' })
  })

  it('hit at L1: no producer, resolve returns L1 view', async () => {
    const l1 = new FakeViewBucket({
      key: 'test:k',
      value: 'cached',
      meta: { storedAt: 12345 },
    })
    const cache = new Cacheable<UrlView>('test', { buckets: [l1] })

    let calls = 0
    const view = await cache.resolve(async () => {
      calls += 1
      return 'fresh'
    }, 'k')

    expect(view).toEqual({ url: 'fake://test:k' })
    expect(calls).toBe(0)
  })

  it('hit at L2: cascade fills L1, resolve returns L1 view', async () => {
    const l1 = new FakeViewBucket()
    const l2 = new FakeViewBucket({
      key: 'test:k',
      value: 'l2-cached',
      meta: { storedAt: 12345 },
    })
    const cache = new Cacheable<UrlView>('test', { buckets: [l1, l2] })

    const view = await cache.resolve(async () => 'fresh', 'k')
    expect(view).toEqual({ url: 'fake://test:k' })
    // L1 was backfilled from L2.
    expect((await l1.meta('test:k'))?.storedAt).toBe(12345)
  })

  it('void-view buckets: resolve returns undefined (typed as void)', async () => {
    const cache = new Cacheable('test', { buckets: [new MemoryBucket()] })
    const view = await cache.resolve(async () => 'v', 'k')
    expect(view).toBeUndefined()
  })
})

describe('cache.resolve(): policy semantics', () => {
  it('cache-only: hit reuses storedAt from L1', async () => {
    const l1 = new FakeViewBucket()
    const cache = new Cacheable<UrlView>('test', { buckets: [l1] })

    const before = Date.now()
    await cache.resolve(async () => 'v', 'k')
    const after = Date.now()

    const stored = (await l1.meta('test:k'))!.storedAt
    expect(stored).toBeGreaterThanOrEqual(before)
    expect(stored).toBeLessThanOrEqual(after)

    await wait(10)
    await cache.resolve(async () => 'v2', 'k')
    expect((await l1.meta('test:k'))!.storedAt).toBe(stored)
  })

  it('network-only: every call writes fresh storedAt', async () => {
    const l1 = new FakeViewBucket()
    const cache = new Cacheable<UrlView>('test', {
      buckets: [l1],
      policy: 'network-only',
    })

    await cache.resolve(async () => 'v', 'k')
    const a = (await l1.meta('test:k'))!.storedAt
    await wait(10)
    await cache.resolve(async () => 'v', 'k')
    const b = (await l1.meta('test:k'))!.storedAt

    expect(b).toBeGreaterThan(a)
  })

  it('network-only-non-concurrent: every serial call writes fresh storedAt', async () => {
    const l1 = new FakeViewBucket()
    const cache = new Cacheable<UrlView>('test', {
      buckets: [l1],
      policy: 'network-only-non-concurrent',
    })

    await cache.resolve(async () => 'v', 'k')
    const a = (await l1.meta('test:k'))!.storedAt
    await wait(10)
    await cache.resolve(async () => 'v', 'k')
    const b = (await l1.meta('test:k'))!.storedAt

    expect(b).toBeGreaterThan(a)
  })

  it('max-age: storedAt is stable within window, refreshes when expired', async () => {
    const l1 = new FakeViewBucket()
    const cache = new Cacheable<UrlView>('test', {
      buckets: [l1],
      policy: 'max-age',
      maxAge: 100,
    })

    await cache.resolve(async () => 'v', 'k')
    const a = (await l1.meta('test:k'))!.storedAt
    await cache.resolve(async () => 'v', 'k')
    expect((await l1.meta('test:k'))!.storedAt).toBe(a)

    await wait(200)
    await cache.resolve(async () => 'v', 'k')
    expect((await l1.meta('test:k'))!.storedAt).toBeGreaterThan(a)
  })

  it('SWR: returns stale view immediately, background revalidation refreshes storedAt', async () => {
    const l1 = new FakeViewBucket()
    const cache = new Cacheable<UrlView>('test', {
      buckets: [l1],
      policy: 'stale-while-revalidate',
      maxAge: 50,
    })

    await cache.resolve(async () => 'v', 'k')
    const a = (await l1.meta('test:k'))!.storedAt
    await wait(150)

    // Stale: returns cached view immediately and kicks off a background refetch.
    await cache.resolve(async () => 'v', 'k')
    // The synchronous resolve still observes the stale storedAt.
    // (The background revalidation may or may not have landed yet.)

    // Give the background refetch plenty of time to land.
    await wait(150)

    await cache.resolve(async () => 'v', 'k')
    expect((await l1.meta('test:k'))!.storedAt).toBeGreaterThan(a)
  })

  it('concurrent remember + resolve share one producer call', async () => {
    const l1 = new FakeViewBucket()
    const cache = new Cacheable<UrlView>('test', { buckets: [l1] })

    let calls = 0
    const slow = async () => {
      calls += 1
      await wait(20)
      return 'v'
    }

    const [value, view] = await Promise.all([
      cache.remember(slow, 'k'),
      cache.resolve(slow, 'k'),
    ])

    expect(calls).toBe(1)
    expect(value).toBe('v')
    expect(view).toEqual({ url: 'fake://test:k' })
  })

  it('logs HIT/MISS with elapsed time, same shape as remember', async () => {
    const log = vi.fn()
    const cache = new Cacheable<UrlView>('test', {
      buckets: [new FakeViewBucket()],
      logger: { log },
    })

    await cache.resolve(async () => 'v', 'k')
    expect(log).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Cacheable "test:k": MISS \d+(\.\d+)?ms$/),
    )

    await cache.resolve(async () => 'v', 'k')
    expect(log).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Cacheable "test:k": HIT \d+(\.\d+)?ms$/),
    )
  })
})

describe('cache.resolve(): view-cascade hot path', () => {
  it('L1 hit (single layer): no value read, only meta + view', async () => {
    const l1 = new FakeViewBucket({
      key: 'test:k',
      value: 'cached',
      meta: { storedAt: 1 },
    })
    const cache = new Cacheable<UrlView>('test', { buckets: [l1] })

    l1.readCalls = 0
    l1.viewCalls = 0

    await cache.resolve(async () => 'fresh', 'k')
    expect(l1.readCalls).toBe(0)
    expect(l1.viewCalls).toBe(1)
  })

  it('L1 hit + L2 also fresh: still skips value read', async () => {
    const now = Date.now()
    const l1 = new FakeViewBucket({
      key: 'test:k',
      value: 'l1',
      meta: { storedAt: now },
    })
    const l2 = new FakeViewBucket({
      key: 'test:k',
      value: 'l2',
      meta: { storedAt: now - 10 },
    })
    const cache = new Cacheable<UrlView>('test', {
      buckets: [l1, l2],
      policy: 'max-age',
      maxAge: 1000,
    })

    l1.readCalls = 0
    l2.readCalls = 0

    await cache.resolve(async () => 'fresh', 'k')
    expect(l1.readCalls).toBe(0)
    expect(l2.readCalls).toBe(0)
  })

  it('L1 hit + L2 missing: reads value to fill L2, then returns L1 view', async () => {
    const l1 = new FakeViewBucket({
      key: 'test:k',
      value: 'l1',
      meta: { storedAt: 1 },
    })
    const l2 = new FakeViewBucket()
    const cache = new Cacheable<UrlView>('test', { buckets: [l1, l2] })

    l1.readCalls = 0

    const view = await cache.resolve(async () => 'fresh', 'k')
    expect(view).toEqual({ url: 'fake://test:k' })
    expect(l1.readCalls).toBe(1)
    expect(l2.store.has('test:k')).toBe(true)
  })

  it('max-age stale L1 + fresh L2: cascade fill refreshes L1, returns L1 view', async () => {
    const now = Date.now()
    const l1 = new FakeViewBucket({
      key: 'test:k',
      value: 'l1-stale',
      meta: { storedAt: now - 500 },
    })
    const l2 = new FakeViewBucket({
      key: 'test:k',
      value: 'l2-fresh',
      meta: { storedAt: now - 50 },
    })
    const cache = new Cacheable<UrlView>('test', {
      buckets: [l1, l2],
      policy: 'max-age',
      maxAge: 100,
    })

    const view = await cache.resolve(async () => 'network', 'k')
    expect(view).toEqual({ url: 'fake://test:k' })
    expect((await l1.meta('test:k'))?.storedAt).toBe(now - 50)
  })
})

describe('cache.resolve(): race healing and strict-mode', () => {
  it('heals race when bucket.view returns undefined despite meta hit', async () => {
    const l1 = new FakeViewBucket({
      key: 'test:k',
      value: 'cached',
      meta: { storedAt: Date.now() },
    })

    let viewCount = 0
    const realView = l1.view.bind(l1)
    l1.view = async (key: string) => {
      viewCount += 1
      if (viewCount === 1) return undefined // simulate eviction race
      return realView(key)
    }

    const cache = new Cacheable<UrlView>('test', { buckets: [l1] })

    let calls = 0
    const view = await cache.resolve(async () => {
      calls += 1
      return 'fresh'
    }, 'k')

    expect(view).toEqual({ url: 'fake://test:k' })
    expect(calls).toBe(1) // race healed via running resource
  })

  it('throws strict-mode error when bucket.view returns undefined after a successful cascade write', async () => {
    const l1 = new FakeViewBucket()
    l1.view = async () => undefined // bucket never produces a view
    const cache = new Cacheable<UrlView>('test', { buckets: [l1] })

    await expect(cache.resolve(async () => 'fresh', 'k')).rejects.toThrow(
      /returned no view.*after a successful cascade write/,
    )
  })

  it('throws strict-mode error when L1 view absent after cascade fill from a deeper hit', async () => {
    const l1 = new FakeViewBucket()
    l1.view = async () => undefined // L1 never exposes a view
    const l2 = new FakeViewBucket({
      key: 'test:k',
      value: 'l2',
      meta: { storedAt: Date.now() },
    })
    const cache = new Cacheable<UrlView>('test', { buckets: [l1, l2] })

    let producerCalls = 0
    await expect(
      cache.resolve(async () => {
        producerCalls += 1
        return 'fresh'
      }, 'k'),
    ).rejects.toThrow(/returned no view.*after a successful cascade fill/)
    // Strict: we did not silently re-run the producer to mask the bug.
    expect(producerCalls).toBe(0)
  })
})
