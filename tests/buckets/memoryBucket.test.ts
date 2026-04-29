import { MemoryBucket } from '../../src'

describe('MemoryBucket', () => {
  it('write persists storedAt verbatim', async () => {
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
    await a.write('k', { hello: 'world' }, { storedAt: 1 })
    expect(await a.read('k')).toEqual({ value: { hello: 'world' } })
  })

  it('read distinguishes a stored undefined from absence', async () => {
    const a = new MemoryBucket()
    await a.write('k', undefined, { storedAt: 1 })
    expect(await a.read('k')).toEqual({ value: undefined })
    expect(await a.read('missing')).toBeUndefined()
  })

  it('view wraps presence as { view: undefined } and returns undefined for absence', async () => {
    const a = new MemoryBucket()
    await a.write('k', 'v', { storedAt: 1 })
    expect(await a.view('k')).toEqual({ view: undefined })
    expect(await a.view('missing')).toBeUndefined()
  })

  it('delete removes only the specified key', async () => {
    const a = new MemoryBucket()
    await a.write('a', 1, { storedAt: 1 })
    await a.write('b', 2, { storedAt: 2 })
    await a.delete('a')
    expect(await a.read('a')).toBeUndefined()
    expect(await a.read('b')).toEqual({ value: 2 })
  })

  it('clear removes everything', async () => {
    const a = new MemoryBucket()
    await a.write('a', 1, { storedAt: 1 })
    await a.write('b', 2, { storedAt: 2 })
    await a.clear()
    expect(await a.read('a')).toBeUndefined()
    expect(await a.read('b')).toBeUndefined()
  })
})
