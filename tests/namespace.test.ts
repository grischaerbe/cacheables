import { Cacheables, MemoryAdapter } from '../src'

describe('namespace', () => {
  it('isolates entries between two instances sharing one adapter', async () => {
    const adapter = new MemoryAdapter()
    const a = new Cacheables({ adapters: [adapter], namespace: 'a' })
    const b = new Cacheables({ adapters: [adapter], namespace: 'b' })

    await a.remember(async () => 'A', 'k')
    await b.remember(async () => 'B', 'k')

    expect(await a.remember(async () => 'fresh', 'k')).toBe('A')
    expect(await b.remember(async () => 'fresh', 'k')).toBe('B')
  })

  it('writes adapter keys with namespace prefix', async () => {
    const adapter = new MemoryAdapter()
    const a = new Cacheables({ adapters: [adapter], namespace: 'tenant1' })

    await a.remember(async () => 'v', 'user:42')

    expect(await adapter.read('tenant1:user:42')).toEqual({ value: 'v' })
    expect(await adapter.read('user:42')).toBeUndefined()
  })

  it('delete on one namespace does not affect another', async () => {
    const adapter = new MemoryAdapter()
    const a = new Cacheables({ adapters: [adapter], namespace: 'a' })
    const b = new Cacheables({ adapters: [adapter], namespace: 'b' })

    await a.remember(async () => 'A', 'k')
    await b.remember(async () => 'B', 'k')

    await a.delete('k')

    expect(await a.isCached('k')).toBe(false)
    expect(await b.isCached('k')).toBe(true)
  })

  it('clear from one namespace wipes shared adapter (documented caveat)', async () => {
    const adapter = new MemoryAdapter()
    const a = new Cacheables({ adapters: [adapter], namespace: 'a' })
    const b = new Cacheables({ adapters: [adapter], namespace: 'b' })

    await a.remember(async () => 'A', 'k')
    await b.remember(async () => 'B', 'k')

    await a.clear()

    expect(await a.isCached('k')).toBe(false)
    expect(await b.isCached('k')).toBe(false)
  })

  it('omitting namespace stores keys verbatim', async () => {
    const adapter = new MemoryAdapter()
    const cache = new Cacheables({ adapters: [adapter] })
    await cache.remember(async () => 'v', 'k')
    expect(await adapter.read('k')).toEqual({ value: 'v' })
  })
})
