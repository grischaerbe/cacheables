import { Cacheables } from '../src'

const mockedApiRequest = (shouldResolve: boolean, value: number) =>
  new Promise((resolve, reject) => {
    if (shouldResolve) {
      resolve(value)
    } else {
      reject()
    }
  })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Cache operations', () => {
  it('Returns correct values', async () => {
    const cache = new Cacheables()
    const value = 10
    const cachedValue = await cache.cacheable(
      () => mockedApiRequest(true, value),
      'a',
    )
    expect(cache.isCached('a')).toEqual(true)
    expect(cache.keys()).toEqual(['a'])
    expect(cachedValue).toEqual(value)
  })

  it('Invalidates correctly', async () => {
    const cache = new Cacheables()

    await cache.cacheable(() => mockedApiRequest(true, 10), 'a', 100)

    expect(cache.isCached('a')).toEqual(true)
    await wait(150)
    expect(cache.isCached('a')).toEqual(false)
    expect(cache.keys()).toEqual(['a'])
  })

  it('Stores multiple caches', async () => {
    const cache = new Cacheables()

    const valueA = 10
    const valueB = 20

    const cachedValueA = await cache.cacheable(
      () => mockedApiRequest(true, valueA),
      'a',
    )
    const cachedValueB = await cache.cacheable(
      () => mockedApiRequest(true, valueB),
      'b',
    )

    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
    expect([cachedValueA, cachedValueB]).toEqual([valueA, valueB])
  })

  it('Invalidates the correct value', async () => {
    const cache = new Cacheables()

    const valueA = 10
    await cache.cacheable(() => mockedApiRequest(true, valueA), 'a', 100)
    const valueB = 20
    await cache.cacheable(() => mockedApiRequest(true, valueB), 'b', 200)

    expect(cache.isCached('a')).toEqual(true)
    expect(cache.isCached('b')).toEqual(true)
    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
    await wait(150)
    expect(cache.isCached('a')).toEqual(false)
    expect(cache.isCached('b')).toEqual(true)
    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
    await wait(250)
    expect(cache.isCached('a')).toEqual(false)
    expect(cache.isCached('b')).toEqual(false)
    expect(cache.keys().sort()).toEqual(['a', 'b'].sort())
  })

  it('Deletes values', async () => {
    const cache = new Cacheables()

    const value = 10
    await cache.cacheable(() => mockedApiRequest(true, value), 'a')

    expect(cache.isCached('a')).toEqual(true)
    cache.delete('a')
    expect(cache.isCached('a')).toEqual(false)
  })

  it('Clears the cache', async () => {
    const cache = new Cacheables()

    const value = 10
    await cache.cacheable(() => mockedApiRequest(true, value), 'a')

    expect(cache.isCached('a')).toEqual(true)
    cache.clear()
    expect(cache.isCached('a')).toEqual(false)
  })

  it('Creates proper keys', () => {
    const key = Cacheables.key('aaa', 'bbb', 'ccc', 'ddd', 10, 20)
    expect(key).toEqual('aaa:bbb:ccc:ddd:10:20')
  })
})
