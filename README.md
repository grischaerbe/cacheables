# Cacheables

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language](https://img.shields.io/github/languages/top/grischaerbe/cacheables)
![Build](https://img.shields.io/github/workflow/status/grischaerbe/cacheables/Node.js%20Package)

A simple in-memory cache with automatic or manual cache invalidation and elegant syntax written in Typescript.

- Elegant syntax: Wrap existing API calls in the `cacheable` method, assign a cache key and optionally a maxAge to save some of those precious API calls.
- Written in Typescript.
- Integrated Logs: Check on the timing of your API calls.
- Helper function to build cache keys.
- Works in the browser and Node.js.
- No dependencies.
- Extensively tested.

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
// Here we set up a method `getWeatherData` that returns a Promise 
// resolving our weather data. Depending on the maxAge `cacheable`
// returns the remotely fetched resource or the cache value.
// It's best practice to generate a single
// source of truth to our cached remote resource.
export const getWeatherData = () => cache.cacheable(() => fetch(apiUrl), 'weather', 5e3)

// Fetch some fresh weather data and store it in our cache.
const weatherData = await getWeatherData()

// 3 seconds later
await wait (3e3)

// In this case the cached weather data is returned as the
// maxAge of 5 seconds probably did not yet expire.
// Please be aware that the timestamp that maxAge is checked
//  against is set **before** the resource is fetched.
const cachedWeatherData = await getWeatherData()

// Another 3 seconds later
await wait (3e3)

// Now that the maxAge of cacheable `weather` is
// expired, the resource will be refetched and stored in our cache.
const freshWeatherData = await getWeatherData()
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

### `cache.cacheable(resource, key, maxAge?): Promise<T>`

- If a resource exists in the cache (determined by the presence of a value with key `key`) `cacheable` returns the cached resource.
- If there's no resource in the cache, the provided argument `resource` will be used to store a value with key `key` and the value is returned.

#### Arguments

##### - `resource: () => Promise<T>`

A function that returns a `Promise<T>`. 

##### - `key: string`

A key to store the cache at.

##### - `maxAge?: number` (optional)

A maxAge in milliseconds after which the cache will be treated as invalid.

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

### `cache.isCached(key: string, maxAge?: number): boolean`

#### Arguments

##### - `key: string`

Returns whether a cacheable is present and valid (i.e., did not time out).

##### - `maxAge?: number` (optional)

A maxAge in milliseconds after which the cache will be treated as invalid.

#### Example

```ts
const aIsCached = cache.isCached('a', 100)
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
