# Cacheables

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language](https://img.shields.io/github/languages/top/grischaerbe/cacheables)

A simple in-memory cache with automatic or manual cache invalidation and elegant syntax written in Typescript.

- Elegant syntax: Wrap existing API calls in the `cacheable` method, assign a cache key and optionally a timeout to save some of those precious API calls.
- Written in Typescript.
- Integrated Logs: Check on the timing of your API calls.
- Helper function to build cache keys.
- Works in the browser and Node.js.
- No dependencies.
- Tested.

## Installation

```bash
npm install cacheables
```

## Usage

```ts
// Import Cacheables
import { Cacheables } from 'cacheables'

// Create a new cache instance
const cache = new Cacheables({
  logTiming: true,
})

// Use the method `cacheable` to set and get from the cache
const cachedApiQuery = (locale: string) =>
  cache.cacheable(
    () => apiQuery(locale),
    Cacheables.key('key', locale),
    60e3,
  )

await cachedApiQuery('de')
// Cache miss: initial call.
// In this example, the response of apiQuery('de') will be
// cached for 60 seconds with the key 'key:de'.

// key:de: 120.922ms

await cachedApiQuery('de')
// Cache hit: resource with key "key:de" is in cache.

// key:de: 0.029ms

await cachedApiQuery('en')
// Cache miss: resource with key "key:en" is not in cache.

// key:en: 156.538ms
```

`cacheable` serves both as the getter and setter. This method will return a cached resource if available or use the provided argument `resource` to fill the cache and return a value.

> Be aware that there is no exclusive getter as the Promise provided by the first argument to `cacheable` is used to infer the return type of the cached resource.

## API

### `new Cacheables(options?): Cacheables`

- Creates a new `Cacheables` instance.

#### Arguments

##### - `options?: CacheOptions`

```ts
interface CacheOptions {
  enabled?: boolean    // Enable/disable the cache, can be set anytime, default: true.
  log?: boolean        // Log hits and misses to the cache, default: false. 
  logTiming?: boolean  // Log the timing of cache hits/misses and returns, default: false.
}
```

#### Example:

```ts
import { Cacheables } from 'cacheables'

const cache = new Cacheables({
  logTiming: true
})
```

### `cache.cacheable(resource, key, timeout?): Promise<T>`

- If a resource exists in the cache (determined by the presence of a value with key `key`) `cacheable` returns the cached resource.
- If there's no resource in the cache, the provided argument `resource` will be used to store a value with key `key` and the value is returned.

#### Arguments

##### - `resource: () => Promise<T>`

A function that returns a `Promise<T>`. 

##### - `key: string`

A key to store the cache at.

##### - `timeout?: number` (optional)

A timeout in milliseconds after which the cache will be invalidated automatically.

#### Example

```ts
const apiResponse = await cache.cacheable(
  () => fetch('https://github.com/'),
  'key',
  60e3
)
```

### `cache.delete(key: string): void`

#### Arguments

##### - `key: string`

Delete a cache for a certain key. This will preserve the hit/miss counts for a cache.

#### Example

```ts
cache.delete('key')
```

### `cache.clear(): void`

Delete all cached resources. This will preserve the hit/miss counts for a cache.

### `cache.keys(): string[]`

Returns all the cache keys

### `Cacheables.key(...args: (string | number)[]): string`

A static helper function to easily build a key for a cache.

#### Example

```ts
const user = Cacheables.key('user', id)
```

## In Progress

PRs welcome

- [ ] Cache invalidation callback
- [ ] Adapters to store cache not only in memory
- [X] Tests

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.