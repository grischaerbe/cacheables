import { Cacheable } from '../src'
import type { BucketEntryMeta, IBucket } from '../src'

interface WriteCall {
  key: string
  value: unknown
  meta: BucketEntryMeta
}

class FakeBucket implements IBucket<void> {
  store = new Map<string, { value: unknown; meta: BucketEntryMeta }>()

  readCalls = 0
  metaCalls = 0
  resolveCalls = 0
  writeCalls: WriteCall[] = []
  deleteCalls: string[] = []
  clearCalls = 0

  throwOn: Partial<
    Record<'read' | 'meta' | 'resolve' | 'write' | 'delete' | 'clear', boolean>
  > = {}

  constructor(seed?: { key: string; value: unknown; meta: BucketEntryMeta }) {
    if (seed) this.store.set(seed.key, { value: seed.value, meta: seed.meta })
  }

  async read<T>(key: string): Promise<{ value: T } | undefined> {
    this.readCalls += 1
    if (this.throwOn.read) throw new Error('read failed')
    const entry = this.store.get(key)
    return entry === undefined ? undefined : { value: entry.value as T }
  }

  async write<T>(key: string, value: T, meta: BucketEntryMeta): Promise<void> {
    this.writeCalls.push({ key, value, meta })
    if (this.throwOn.write) throw new Error('write failed')
    this.store.set(key, { value, meta })
  }

  async meta(key: string): Promise<BucketEntryMeta | undefined> {
    this.metaCalls += 1
    if (this.throwOn.meta) throw new Error('meta failed')
    return this.store.get(key)?.meta
  }

  async resolve(key: string): Promise<{ view: void } | undefined> {
    this.resolveCalls += 1
    if (this.throwOn.resolve) throw new Error('resolve failed')
    return this.store.has(key) ? { view: undefined } : undefined
  }

  async delete(key: string): Promise<void> {
    this.deleteCalls.push(key)
    if (this.throwOn.delete) throw new Error('delete failed')
    this.store.delete(key)
  }

  async clear(): Promise<void> {
    this.clearCalls += 1
    if (this.throwOn.clear) throw new Error('clear failed')
    this.store.clear()
  }
}

describe('cascade behavior', () => {
  it('L1 hit: does not read L2, probes L2 once, no writes', async () => {
    const seedMeta: BucketEntryMeta = { storedAt: Date.now() }
    const l1 = new FakeBucket({ key: 'test:k', value: 'v', meta: seedMeta })
    const l2 = new FakeBucket()
    const cache = new Cacheable('test', { buckets: [l1, l2] })

    const result = await cache.remember(async () => 'fresh', 'k')

    expect(result).toEqual('v')
    expect(l1.readCalls).toBe(1)
    expect(l2.readCalls).toBe(0)
    expect(l2.metaCalls).toBe(1)
    // L2 had no entry → backfill writes once with L1's meta.
    expect(l2.writeCalls.length).toBe(1)
    expect(l2.writeCalls[0]!.meta.storedAt).toBe(seedMeta.storedAt)
    // L1 already had it → no L1 write.
    expect(l1.writeCalls.length).toBe(0)
  })

  it('L1 hit + L2 already has it: no writes anywhere', async () => {
    const seedMeta: BucketEntryMeta = { storedAt: 1000 }
    const l1 = new FakeBucket({ key: 'test:k', value: 'v', meta: seedMeta })
    const l2 = new FakeBucket({
      key: 'test:k',
      value: 'v',
      meta: { storedAt: 999 },
    })
    const cache = new Cacheable('test', { buckets: [l1, l2] })

    await cache.remember(async () => 'fresh', 'k')

    expect(l1.writeCalls.length).toBe(0)
    expect(l2.writeCalls.length).toBe(0)
  })

  it('L1 miss + L2 hit: L1 backfilled with L2 meta (storedAt preserved)', async () => {
    const l2Meta: BucketEntryMeta = { storedAt: 12345 }
    const l1 = new FakeBucket()
    const l2 = new FakeBucket({ key: 'test:k', value: 'v2', meta: l2Meta })
    const cache = new Cacheable('test', { buckets: [l1, l2] })

    const result = await cache.remember(async () => 'fresh', 'k')

    expect(result).toEqual('v2')
    expect(l1.writeCalls.length).toBe(1)
    expect(l1.writeCalls[0]!.value).toBe('v2')
    expect(l1.writeCalls[0]!.meta.storedAt).toBe(l2Meta.storedAt)
    // L2 already had it → no extra L2 write.
    expect(l2.writeCalls.length).toBe(0)
    expect(l2.readCalls).toBe(1)
  })

  it('Both miss: resource called once; both layers written with the same engine-minted meta', async () => {
    const l1 = new FakeBucket()
    const l2 = new FakeBucket()
    const cache = new Cacheable('test', { buckets: [l1, l2] })

    const before = Date.now()
    let calls = 0
    const result = await cache.remember(async () => {
      calls += 1
      return 'fresh'
    }, 'k')
    const after = Date.now()

    expect(result).toEqual('fresh')
    expect(calls).toBe(1)

    expect(l1.writeCalls.length).toBe(1)
    expect(l1.writeCalls[0]!.value).toBe('fresh')
    const l1WriteMeta = l1.writeCalls[0]!.meta
    expect(l1WriteMeta.storedAt).toBeGreaterThanOrEqual(before)
    expect(l1WriteMeta.storedAt).toBeLessThanOrEqual(after)

    expect(l2.writeCalls.length).toBe(1)
    expect(l2.writeCalls[0]!.value).toBe('fresh')
    expect(l2.writeCalls[0]!.meta.storedAt).toBe(l1WriteMeta.storedAt)
  })

  it('3 layers, L3 hit: L1 and L2 both filled with L3 meta', async () => {
    const l3Meta: BucketEntryMeta = { storedAt: 42 }
    const l1 = new FakeBucket()
    const l2 = new FakeBucket()
    const l3 = new FakeBucket({ key: 'test:k', value: 'deep', meta: l3Meta })
    const cache = new Cacheable('test', { buckets: [l1, l2, l3] })

    const result = await cache.remember(async () => 'fresh', 'k')

    expect(result).toEqual('deep')
    expect(l1.writeCalls.length).toBe(1)
    expect(l2.writeCalls.length).toBe(1)
    expect(l3.writeCalls.length).toBe(0)
    expect(l1.writeCalls[0]!.meta.storedAt).toBe(42)
    expect(l2.writeCalls[0]!.meta.storedAt).toBe(42)
  })

  it('max-age across layers: stale L1 with fresh L2 returns L2 value', async () => {
    const now = Date.now()
    const l1 = new FakeBucket({
      key: 'test:k',
      value: 'l1-stale',
      meta: { storedAt: now - 500 },
    })
    const l2 = new FakeBucket({
      key: 'test:k',
      value: 'l2-fresh',
      meta: { storedAt: now - 50 },
    })
    const cache = new Cacheable('test', {
      buckets: [l1, l2],
      policy: 'max-age',
      maxAge: 100,
    })

    let calls = 0
    const result = await cache.remember(async () => {
      calls += 1
      return 'network'
    }, 'k')

    expect(result).toEqual('l2-fresh')
    expect(calls).toBe(0)
  })

  it('max-age stale L1 + fresh L2: cascade fill refreshes L1 with L2 value and meta', async () => {
    const now = Date.now()
    const l1 = new FakeBucket({
      key: 'test:k',
      value: 'l1-stale',
      meta: { storedAt: now - 500 },
    })
    const l2 = new FakeBucket({
      key: 'test:k',
      value: 'l2-fresh',
      meta: { storedAt: now - 50 },
    })
    const cache = new Cacheable('test', {
      buckets: [l1, l2],
      policy: 'max-age',
      maxAge: 100,
    })

    const result = await cache.remember(async () => 'network', 'k')
    expect(result).toEqual('l2-fresh')
    expect(l1.writeCalls.length).toBe(1)
    expect(l1.writeCalls[0]!.value).toBe('l2-fresh')
    expect(l1.writeCalls[0]!.meta.storedAt).toBe(now - 50)
  })

  it('max-age miss across all layers calls resource', async () => {
    const now = Date.now()
    const l1 = new FakeBucket({
      key: 'test:k',
      value: 'l1-stale',
      meta: { storedAt: now - 500 },
    })
    const l2 = new FakeBucket({
      key: 'test:k',
      value: 'l2-stale',
      meta: { storedAt: now - 500 },
    })
    const cache = new Cacheable('test', {
      buckets: [l1, l2],
      policy: 'max-age',
      maxAge: 100,
    })

    let calls = 0
    const result = await cache.remember(async () => {
      calls += 1
      return 'network'
    }, 'k')

    expect(result).toEqual('network')
    expect(calls).toBe(1)
  })

  it('delete propagates to all buckets', async () => {
    const l1 = new FakeBucket()
    const l2 = new FakeBucket()
    const cache = new Cacheable('test', { buckets: [l1, l2] })

    await cache.remember(async () => 'v', 'k')
    await cache.delete('k')

    expect(l1.deleteCalls).toEqual(['test:k'])
    expect(l2.deleteCalls).toEqual(['test:k'])
  })

  it('clear propagates to all buckets', async () => {
    const l1 = new FakeBucket()
    const l2 = new FakeBucket()
    const cache = new Cacheable('test', { buckets: [l1, l2] })

    await cache.remember(async () => 'v', 'k')
    await cache.clear()

    expect(l1.clearCalls).toBe(1)
    expect(l2.clearCalls).toBe(1)
  })

  it('cascade fill propagates highest-priority layer meta to lower layers', async () => {
    const l1 = new FakeBucket()
    const l2 = new FakeBucket({
      key: 'test:k',
      value: 'v',
      meta: { storedAt: 999 },
    })
    const cache = new Cacheable('test', { buckets: [l1, l2] })

    expect((await l1.meta('test:k'))?.storedAt).toBeUndefined()
    expect((await l2.meta('test:k'))?.storedAt).toBe(999)

    await cache.remember(async () => 'fresh', 'k')

    // L1 is now backfilled with L2's storedAt verbatim.
    expect((await l1.meta('test:k'))?.storedAt).toBe(999)
  })

  it('caches resources that resolve to undefined', async () => {
    const l1 = new FakeBucket()
    const cache = new Cacheable('test', { buckets: [l1] })

    let calls = 0
    const resource = async () => {
      calls += 1
      return undefined
    }

    const a = await cache.remember(resource, 'k')
    const b = await cache.remember(resource, 'k')
    const c = await cache.remember(resource, 'k')

    expect(calls).toBe(1)
    expect(a).toBeUndefined()
    expect(b).toBeUndefined()
    expect(c).toBeUndefined()
  })

  it('treats meta-says-yes / read-says-undefined as a miss', async () => {
    // Simulates a delete that races between #cascadeProbe and bucket.read:
    // meta still reports the entry; read claims absence.
    const l1 = new FakeBucket({
      key: 'test:k',
      value: 'stale',
      meta: { storedAt: Date.now() },
    })
    l1.read = async <T>(): Promise<{ value: T } | undefined> => {
      l1.readCalls += 1
      return undefined
    }

    const cache = new Cacheable('test', { buckets: [l1] })

    let calls = 0
    const result = await cache.remember(async () => {
      calls += 1
      return 'fresh'
    }, 'k')

    expect(result).toBe('fresh')
    expect(calls).toBe(1)
  })
})

describe('cascade strict error propagation', () => {
  it('rejects when meta() throws', async () => {
    const l1 = new FakeBucket()
    l1.throwOn.meta = true
    const cache = new Cacheable('test', { buckets: [l1] })

    await expect(cache.remember(async () => 'v', 'k')).rejects.toThrow(
      'meta failed',
    )
  })

  it('rejects when read() throws on hit', async () => {
    const l1 = new FakeBucket({
      key: 'test:k',
      value: 'v',
      meta: { storedAt: Date.now() },
    })
    l1.throwOn.read = true
    const cache = new Cacheable('test', { buckets: [l1] })

    await expect(cache.remember(async () => 'fresh', 'k')).rejects.toThrow(
      'read failed',
    )
  })

  it('rejects when write() throws on miss', async () => {
    const l1 = new FakeBucket()
    l1.throwOn.write = true
    const cache = new Cacheable('test', { buckets: [l1] })

    await expect(cache.remember(async () => 'fresh', 'k')).rejects.toThrow(
      'write failed',
    )
  })

  it('rejects when delete() throws', async () => {
    const l1 = new FakeBucket()
    l1.throwOn.delete = true
    const cache = new Cacheable('test', { buckets: [l1] })

    await expect(cache.delete('k')).rejects.toThrow('delete failed')
  })

  it('rejects when clear() throws', async () => {
    const l1 = new FakeBucket()
    l1.throwOn.clear = true
    const cache = new Cacheable('test', { buckets: [l1] })

    await expect(cache.clear()).rejects.toThrow('clear failed')
  })
})

describe('concurrent dedup', () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it('cache-only: deduplicates concurrent miss callers', async () => {
    const l1 = new FakeBucket()
    const cache = new Cacheable('test', { buckets: [l1] })

    let calls = 0
    const slow = async () => {
      calls += 1
      await wait(20)
      return 'v'
    }

    const results = await Promise.all(
      Array.from({ length: 100 }, () => cache.remember(slow, 'k')),
    )
    expect(results.every((r) => r === 'v')).toBe(true)
    expect(calls).toBe(1)
  })

  it('network-only-non-concurrent: deduplicates concurrent callers', async () => {
    const l1 = new FakeBucket()
    const cache = new Cacheable('test', {
      buckets: [l1],
      policy: 'network-only-non-concurrent',
    })

    let calls = 0
    const slow = async () => {
      calls += 1
      await wait(20)
      return 'v'
    }

    const results = await Promise.all(
      Array.from({ length: 100 }, () => cache.remember(slow, 'k')),
    )
    expect(results.every((r) => r === 'v')).toBe(true)
    expect(calls).toBe(1)
  })

  it('max-age: deduplicates concurrent miss callers', async () => {
    const l1 = new FakeBucket()
    const cache = new Cacheable('test', {
      buckets: [l1],
      policy: 'max-age',
      maxAge: 1000,
    })

    let calls = 0
    const slow = async () => {
      calls += 1
      await wait(20)
      return 'v'
    }

    const results = await Promise.all(
      Array.from({ length: 100 }, () => cache.remember(slow, 'k')),
    )
    expect(results.every((r) => r === 'v')).toBe(true)
    expect(calls).toBe(1)
  })

  it('SWR miss: deduplicates concurrent miss callers', async () => {
    const l1 = new FakeBucket()
    const cache = new Cacheable('test', {
      buckets: [l1],
      policy: 'stale-while-revalidate',
    })

    let calls = 0
    const slow = async () => {
      calls += 1
      await wait(20)
      return 'v'
    }

    const results = await Promise.all(
      Array.from({ length: 100 }, () => cache.remember(slow, 'k')),
    )
    expect(results.every((r) => r === 'v')).toBe(true)
    expect(calls).toBe(1)
  })

  it('network-only: does NOT deduplicate (control)', async () => {
    const l1 = new FakeBucket()
    const cache = new Cacheable('test', {
      buckets: [l1],
      policy: 'network-only',
    })

    let calls = 0
    const slow = async () => {
      calls += 1
      await wait(20)
      return calls
    }

    const results = await Promise.all(
      Array.from({ length: 100 }, () => cache.remember(slow, 'k')),
    )
    expect(results.length).toBe(100)
    expect(calls).toBe(100)
  })
})
