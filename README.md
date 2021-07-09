# Cacheables

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language](https://img.shields.io/github/languages/top/grischaerbe/cacheables)
![Build](https://img.shields.io/github/workflow/status/grischaerbe/cacheables/Node.js%20Package)

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

## Quickstart

[https://codesandbox.io/s/quickstart-cacheables-5zh6h?file=/src/index.ts](https://codesandbox.io/s/quickstart-cacheables-5zh6h?file=/src/index.ts)

## Usage

```ts
// Import Cacheables
import { Cacheables } from "cacheables"

const apiUrl = "https://goweather.herokuapp.com/weather/Karlsruhe"

// Create a new cache instance
const cache = new Cacheables({
  logTiming: true,
  log: true
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Use the method `cacheable` to both set and get from the cache
const fetchCached = (url: string, key: string, timeout?: number) => {
  return cache.cacheable(() => fetch(url), key, timeout)
}

const getWeatherData = async () => {
  // Fetch weather and cache for 5 seconds.
  const freshWeatherData = await fetchCached(apiUrl, "weather", 5e3)
  console.log(freshWeatherData)

  // wait 2 seconds
  await wait(2e3)

  // Fetch cached weather, set the timeout to 1 second.
  const cachedWeatherData = await fetchCached(apiUrl, "weather", 1e3)
  console.log(cachedWeatherData)

  // wait 5 seconds
  await wait(3e3)

  // Fetch again, this time the cache is not present anymore.
  const againFreshWeatherData = await fetchCached(apiUrl, "weather")
  console.log(againFreshWeatherData)
}

getWeatherData()
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

### `cache.isCached(key: string): boolean`

#### Arguments

##### - `key: string`

Returns whether a cacheable is present and valid (i.e., did not time out).

#### Example

```ts
const aIsCached = cache.isCached('a')
```

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