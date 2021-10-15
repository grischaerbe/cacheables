# Cacheables

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language](https://img.shields.io/github/languages/top/grischaerbe/cacheables)
![Build](https://img.shields.io/github/workflow/status/grischaerbe/cacheables/Node.js%20Package)

A simple in-memory cache with support of different cache policies and elegant syntax written in Typescript.

- Elegant syntax: **Wrap existing API calls** to save some of those precious API calls.
- **Fully typed results**. No type casting required.
- Supports different **cache policies**.
- Written in **Typescript**.
- **Integrated Logs**: Check on the timing of your API calls.
- Helper function to build cache keys.
- Works in the browser and Node.js.
- **No dependencies**.
- Extensively tested.
- **Small**: 1.43 kB minified and gzipped.

```ts
// without caching
fetch('https://some-url.com/api')

// with caching
cache.cacheable(() => fetch('https://some-url.com/api'), 'key')
```

* [Installation](#installation)
* [Quickstart](#quickstart)
* [Usage](#usage)
* [API](#api)
  * [new Cacheables(options?): Cacheables](#new-cacheablesoptions-cacheables)
  * [cache.cacheable(resource, key, options?): Promise&lt;T&gt;](#cachecacheableresource-key-options-promiset)
  * [cache.delete(key: string): void](#cachedeletekey-string-void)
  * [cache.clear(): void](#cacheclear-void)
  * [cache.keys(): string[]](#cachekeys-string)
  * [cache.isCached(key: string): boolean](#cacheiscachedkey-string-boolean)
  * [Cacheables.key(...args: (string | number)[]): string](#cacheableskeyargs-string--number-string)
* [Cache Policies](#cache-policies)
  * [Cache Only](#cache-only)
  * [Network Only](#network-only)
  * [Network Only – Non Concurrent](#network-only--non-concurrent)
  * [Max Age](#max-age)
  * [Stale While Revalidate](#stale-while-revalidate)
  * [Cache Policy Composition](#cache-policy-composition)
* [In Progress](#in-progress)
* [License](#license)

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

// Wrap the existing API call `fetch(apiUrl)` and assign a cache
// key `weather` to it. This example uses the cache policy 'max-age'
// which invalidates the cache after a certain time.
// The method returns a fully typed Promise just like `fetch(apiUrl)`
// would but with the benefit of caching the result.
const getWeatherData = () =>
  cache.cacheable(() => fetch(apiUrl), 'weather', {
    cachePolicy: 'max-age',
    maxAge: 5e3,
  })

const start = async () => {
  // Fetch some fresh weather data and store it in our cache.
  const weatherData = await getWeatherData()

  /** 3 seconds later **/
  await wait(3e3)

  // The cached weather data is returned as the
  // maxAge of 5 seconds did not yet expire.
  const cachedWeatherData = await getWeatherData()

  /** Another 3 seconds later **/
  await wait(3e3)

  // Now that the maxAge is expired, the resource
  // will be fetched and stored in our cache.
  const freshWeatherData = await getWeatherData()
}

start()
```

`cacheable` serves both as the getter and setter. This method will return a cached resource if available or use the provided argument `resource` to fill the cache and return a value.

> Be aware that there is no exclusive cache getter (like `cache.get('key)`). This is by design as the Promise provided by the first argument to `cacheable` is used to infer the return type of the cached resource.

## API

### `new Cacheables(options?): Cacheables`

- Creates a new `Cacheables` instance.

#### Arguments

##### - `options?: CacheOptions`

```ts
interface CacheOptions {
  enabled?: boolean    // Enable/disable the cache, can be set anytime, default: true.
  log?: boolean        // Log hits to the cache, default: false. 
  logTiming?: boolean  // Log the timing, default: false.
}
```

#### Example:

```ts
import { Cacheables } from 'cacheables'

const cache = new Cacheables({
  logTiming: true
})
```

### `cache.cacheable(resource, key, options?): Promise<T>`

- If a resource exists in the cache (determined by the presence of a value with key `key`) `cacheable` decides on returning a cache based on the provided cache policy.
- If there's no resource in the cache, the provided `resource` will be called and used to store a cache value with key `key` and the value is returned.

#### Arguments

##### - `resource: () => Promise<T>`

A function that returns a `Promise<T>`.

##### - `key: string`

A key to store the cache at.  
See [Cacheables.key()](#cacheableskeyargs-string--number-string) for a safe and easy way to generate unique keys.

##### - `options?: CacheableOptions` (optional)

An object defining the cache policy and possibly other options in the future.
The default cache policy is `cache-only`.
See [Cache Policies](#cache-policies).

```ts
type CacheableOptions = {
  cachePolicy: 'cache-only' | 'network-only-non-concurrent' | 'network-only' | 'max-age' | 'stale-while-revalidate' // See cache policies for details
  maxAge?: number // Required if cache policy is `max-age`
}
```

#### Example

```ts
const cachedApiResponse = await cache.cacheable(
  () => fetch('https://github.com/'),
  'key',
  {
    cachePolicy: 'max-age',
    maxAge: 10e3
  }
)
```

### `cache.delete(key: string): void`

#### Arguments

##### - `key: string`

Delete a cache for a certain key.

#### Example

```ts
cache.delete('key')
```

### `cache.clear(): void`

Delete all cached resources.

### `cache.keys(): string[]`

Returns all the cache keys

### `cache.isCached(key: string): boolean`

#### Arguments

##### - `key: string`

Returns whether a cacheable is present for a certain key.

#### Example

```ts
const aIsCached = cache.isCached('a')
```

### `Cacheables.key(...args: (string | number)[]): string`

A static helper function to easily build safe and consistent cache keys.

#### Example

```ts
const id = '5d3c5be6-2da4-11ec-8d3d-0242ac130003'
console.log(Cacheables.key('user', id))
// 'user:5d3c5be6-2da4-11ec-8d3d-0242ac130003'
```

## Cache Policies

*Cacheables* comes with multiple cache policies.  
Each policy has different behaviour when it comes to preheating the cache (i.e. the first time it is requested) and balancing network requests.

| Cache Policy                  | Behaviour                                                                                                                                                                                                                                                               |
|-------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `cache-only` (default)        | All requests should return a value from the cache.                                                                                                                                                                                                                      |
| `network-only`                | All requests should be handled by the network.<br>Simultaneous requests trigger simultaneous network requests.                                                                                                                                                          |
| `network-only-non-concurrent` | All requests should be handled by the network but no concurrent network requests are allowed.<br>All requests made in the timeframe of a network request are resolved once that is finished.                                                                            |
| `max-age`                     | All requests should be checked against max-age.<br>If max-age is expired, a network request is triggered.<br>All requests made in the timeframe of a network request are resolved once that is finished.                                                                |
| `stale-while-revalidate`      | All requests immediately return a cached value.<br>If no network request is running, a network request is triggered, 'silently' updating the cache in the background.<br>After the network request finished, subsequent requests will receive the updated cached value. |

### Cache Only (default)

The default and simplest cache policy. If there is a cache, return it.  
If there is no cache yet, all calls will be resolved by the first network request (i.e. non-concurrent).

##### Example
```ts
cache.cacheable(() => fetch(url), 'a', { cachePolicy: 'cache-only' })
```

### Network Only

The opposite of `cache-only`.  
Simultaneous requests trigger simultaneous network requests.

##### Example
```ts
cache.cacheable(() => fetch(url), 'a', { cachePolicy: 'network-only' })
```

### Network Only – Non Concurrent

A version of `network-only` but only one network request is running at any point in time.  
All requests should be handled by the network but no concurrent network requests are allowed. All requests made in the timeframe of a network request are resolved once that is finished.

##### Example
```ts
cache.cacheable(() => fetch(url), 'a', { cachePolicy: 'network-only-non-concurrent' })
```

### Max Age

The cache policy `max-age` defines after what time a cached value is treated as invalid.  
All requests should be checked against max-age. If max-age is expired, a network request is triggered. All requests made in the timeframe of a network request are resolved once that is finished.

##### Example
```ts
// Trigger a network request if the cached value is older than 1 second.
cache.cacheable(() => fetch(url), 'a', { 
  cachePolicy: 'max-age',
  maxAge: 1000
})
```

### Stale While Revalidate

The cache policy `stale-while-revalidate` will return a cached value immediately and – if there is no network request already running – trigger a network request to 'silently' update the cache in the background.

##### Example
```ts
// If there is a cache, return it but 'silently' update the cache.
cache.cacheable(() => fetch(url), 'a', { cachePolicy: 'stale-while-revalidate'})
```

### Cache Policy Composition
A single cacheable can be requested with different cache policies at any time.

#### Example
```ts
// If there is a cache, return it.
cache.cacheable(() => fetch(url), 'a', { cachePolicy: 'cache-only' })

// If there is a cache, return it but 'silently' update the cache.
cache.cacheable(() => fetch(url), 'a', { cachePolicy: 'stale-while-revalidate' })
```

## In Progress

PRs welcome

- [ ] ~~Cache invalidation callback~~
- [ ] Adapters to store cache not only in memory
- [X] Cache policies
- [X] Tests

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
