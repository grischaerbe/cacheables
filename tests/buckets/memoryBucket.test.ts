import { MemoryBucket } from '../../src'

describe('MemoryBucket', () => {
  it('write without meta synthesizes storedAt: Date.now()', async () => {
    const a = new MemoryBucket()
    const before = Date.now()
    await a.write('k', 'v')
    const after = Date.now()
    const meta = await a.meta('k')
    expect(meta).toBeDefined()
    expect(meta!.storedAt).toBeGreaterThanOrEqual(before)
    expect(meta!.storedAt).toBeLessThanOrEqual(after)
  })

  it('write with meta persists storedAt verbatim', async () => {
    const a = new MemoryBucket()
    await a.write('k', 'v', { storedAt: 12345 })
    const meta = await a.meta('k')
    expect(meta?.storedAt).toBe(12345)
  })

  it('read returns undefined for missing keys', async () => {
    const a = new MemoryBucket()
    expect(await a.read('missing')).toBeUndefined()
    expect(await a.meta('missing')).toBeUndefined()
  })

  it('read returns stored value wrapped', async () => {
    const a = new MemoryBucket()
    await a.write('k', { hello: 'world' })
    expect(await a.read('k')).toEqual({ value: { hello: 'world' } })
  })

  it('read distinguishes a stored undefined from absence', async () => {
    const a = new MemoryBucket()
    await a.write('k', undefined)
    expect(await a.read('k')).toEqual({ value: undefined })
    expect(await a.read('missing')).toBeUndefined()
  })

  it('delete removes only the specified key', async () => {
    const a = new MemoryBucket()
    await a.write('a', 1)
    await a.write('b', 2)
    await a.delete('a')
    expect(await a.read('a')).toBeUndefined()
    expect(await a.read('b')).toEqual({ value: 2 })
  })

  it('clear removes everything', async () => {
    const a = new MemoryBucket()
    await a.write('a', 1)
    await a.write('b', 2)
    await a.clear()
    expect(await a.read('a')).toBeUndefined()
    expect(await a.read('b')).toBeUndefined()
  })
})
