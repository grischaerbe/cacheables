# Cacheables

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language](https://img.shields.io/github/languages/top/grischaerbe/cacheables)

A simple in-memory cache with automatic or manual cache invalidation and elegant syntax written in Typescript.

- Elegant syntax: Wrap existing API calls in the `cacheable` method, assign a cache key and optionally a timeout to save some of those precious API calls.
- Written in Typescript.
- Integrated Logs: Check on the timing of your API calls.
- Helper function to build cache keys.
- Works in the browser and Node.js
- No dependencies

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
const myCachedApiQuery = (locale: string) =>
  cache.cacheable(
    () => myApiQuery(locale),
    Cacheables.key('myKey', locale),
    60e3,
  )

await myCachedApiQuery('de')
// Cache miss: initial call.
// In this example, the response of myApiQuery('de') will be
// cached for 60 seconds with the key 'myKey:de'.

// myKey:de: 120.922ms

await myCachedApiQuery('de')
// Cache hit.

// myKey:de: 0.029ms

await myCachedApiQuery('en')
// Cache miss: resource with key "myKey:en" not in cache.

// myKey:en: 156.538ms
```

`cacheable` serves both as the getter and setter. This method will return a cached resource if available or use the provided argument `resource` to fill the cache and return a value.

> Be aware that there is no exclusive getter as the Promise provided by the first argument to `cacheable` is used to infer the return type of the cache.

## API

### `new Cacheables(options?): Cacheables`

#### `options.log` (optional)

Log hits and misses to the cache.

#### `options.enabled` (optional)

Enable/Disable caching, can be set anytime.

#### `options.logTiming` (optional)

Log the timing of cache hits/misses and returns.

#### Example:

```ts
import { Cacheables } from 'cacheables'

const cache = new Cacheables({
  logTiming: true
})
```

### `cache.cacheables(resource: () => Promise<T>, key: string, timeout?: number): Promise<T>`

#### `resource`

A function that returns a `Promise<T>`.

#### `key`

A key to store the cache at.

#### `timeout` (optional)

A timeout in milliseconds after which the cache will be invalidated automatically.

#### Example

```ts
const myApiResponse = await cache.cacheable(
  () => fetch('https://github.com/'),
  'myKey',
  60e3
)
```

### `cache.delete(key: string): void`

#### `key`

Delete a cache for a certain key. This will preserve the hit/miss counts for a cache.

#### Example

```ts
cache.delete('myKey')
```

### `cache.clear(): void`

Delete all cached resources. This will preserve the hit/miss counts for a cache.

### `cache.keys(): string[]`

Returns all the cache keys

### `Cacheables.key(...args: (string | number)[]): string`

A static helper function to easily build a key for a cache.

#### Example

```ts
const myKey = Cacheables.key('myType', someVariable, otherVariable)
```

## In Progress

PRs welcome

- [ ] Adapters to store cache not only in memory
- [ ] Tests
- [ ] Cache invalidation callback

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.