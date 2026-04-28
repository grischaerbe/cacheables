# Cacheables

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language](https://img.shields.io/github/languages/top/grischaerbe/cacheables)
![Build](https://img.shields.io/github/workflow/status/grischaerbe/cacheables/Node.js%20Package)

A small, typed cache with composable storage buckets and a handful of cache policies, written in TypeScript.

- Elegant syntax: **wrap existing async calls** with `cache.remember(...)`.
- **Multilayer storage**: compose a fast in-memory L1 with any L2 you write (filesystem, Redis, S3, …). Reads cascade L1 → Ln; on any hit the engine fills missing layers.
- **Fully typed results**, including a generic `TMeta` parameter for sidecar metadata.
- Supports different **cache policies**.
- Helper to build cache keys.
- Required **namespace** prefix so multiple instances can share a bucket without collisions.
- Works in the browser and Node.js.
- **No dependencies**.

```ts
import { Cacheable, MemoryBucket } from 'cacheables'

const cache = new Cacheable({ buckets: [new MemoryBucket()], namespace: 'app' })

cache.remember(() => fetch('https://some-url.com/api'), 'key')
```

* [Installation](#installation)
* [Usage](#usage)
* [API](#api)
  * [new Cacheable(options)](#new-cacheableoptions-cacheabletmeta)
  * [cache.remember(resource, key)](#cacherememberresource-key-promiset)
  * [cache.delete(key)](#cachedeletekey-promisevoid)
  * [cache.clear()](#cacheclear-promisevoid)
  * [cache.isCached(key)](#cacheiscachedkey-promiseboolean)
  * [cache.meta(key)](#cachemetakey-promisetmeta--undefined)
  * [Cacheable.key(...args)](#cacheablekeyargs-string)
* [Buckets](#buckets)
  * [`IBucket` contract](#ibucket-contract)
  * [Built-in `MemoryBucket`](#built-in-memorybucket)
  * [Writing your own bucket](#writing-your-own-bucket)
  * [Cascade behavior](#cascade-behavior)
  * [Typed metadata (`TMeta`)](#typed-metadata-tmeta)
* [Logger](#logger)
  * [`ILogger` contract](#ilogger-contract)
  * [Built-in `ConsoleLogger`](#built-in-consolelogger)
  * [Writing your own logger](#writing-your-own-logger)
* [Namespacing](#namespacing)
* [Cache Policies](#cache-policies)
* [Migrating from v2 → v3](#migrating-from-v2--v3)
* [License](#license)

## Installation

```bash
npm install cacheables
```

## Usage

```ts
import { Cacheable, MemoryBucket } from 'cacheables'

const apiUrl = 'https://goweather.herokuapp.com/weather/Karlsruhe'

const cache = new Cacheable({
  buckets: [new MemoryBucket()],
  namespace: 'weather',
  policy: 'max-age',
  maxAge: 5_000,
})

const getWeather = () => cache.remember(() => fetch(apiUrl), 'weather')

await getWeather() // miss — fetched
await getWeather() // hit — cached
```

`remember` is both getter and setter. The first time a key is requested it calls the resource and stores the result in every configured bucket; subsequent reads cascade through the buckets until one returns a hit.

## API

### `new Cacheable(options): Cacheable<TMeta>`

```ts
type CacheableOptions<TMeta extends IBaseMeta = IBaseMeta> = {
  buckets: IBucket<TMeta>[]            // REQUIRED, L1 first
  namespace: string                    // REQUIRED — bucket keys become `${namespace}:${key}`
  logger?: ILogger                     // default: undefined (no logging)
} & (
  | { policy?: 'cache-only' }                                // default
  | { policy: 'network-only' }
  | { policy: 'network-only-non-concurrent' }
  | { policy: 'max-age', maxAge: number }
  | { policy: 'stale-while-revalidate', maxAge?: number }
)
```

`buckets` must be a non-empty array; the constructor throws `Error('At least one bucket is required')` otherwise. The first bucket is L1 (fastest, queried first); the rest form deeper layers.

### `cache.remember(resource, key): Promise<T>`

Resolves to the cached value if present (subject to policy), otherwise calls `resource()` and stores the result in every bucket.

### `cache.delete(key): Promise<void>`

Deletes the entry from every bucket.

### `cache.clear(): Promise<void>`

Clears every bucket and the in-flight registry.

### `cache.isCached(key): Promise<boolean>`

`true` if any layer reports the key (existence-only — does not consider freshness).

### `cache.meta(key): Promise<TMeta | undefined>`

Returns the meta from the highest-priority layer that has the key — useful for inspecting sidecar fields like `etag`, `ttl`, etc.

### `Cacheable.key(...args): string`

Joins the parts with `:`. Identical to v2.

```ts
Cacheable.key('user', 42) // 'user:42'
```

## Buckets

A bucket is a single storage tier — memory, Redis, disk, S3, anything you can read and write by key. A `Cacheable` instance holds an ordered list of buckets and cascades reads and writes across them.

### `IBucket` contract

```ts
interface IBaseMeta {
  storedAt: number
}

interface IBucket<TMeta extends IBaseMeta = IBaseMeta> {
  read<T>(key: string): Promise<{ value: T } | undefined>
  write<T>(key: string, value: T, meta?: TMeta): Promise<void>
  meta(key: string): Promise<TMeta | undefined>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
```

Rules:

- `meta` MUST be cheap. The engine probes it on every layer for every read.
- `read` returns `undefined` when the entry is absent and `{ value }` when it's present — the wrapper exists so buckets can store entries whose value is itself `undefined` without colliding with the absence signal.
- When `write` receives a `meta`, the bucket MUST persist `meta.storedAt` verbatim (other fields MAY be transformed). This guarantees `max-age` semantics stay coherent across layers.
- When `write` is called with no `meta`, the bucket MUST synthesize one with `storedAt: Date.now()`.
- `clear` MUST remove every entry the bucket manages.
- Any throw from any bucket rejects the surrounding `remember()` call. There is no per-bucket error suppression.

### Built-in `MemoryBucket`

Ships with the package; covers the common in-memory use case.

```ts
import { Cacheable, MemoryBucket } from 'cacheables'

const cache = new Cacheable({ buckets: [new MemoryBucket()], namespace: 'app' })
```

### Writing your own bucket

Implement `IBucket`. The contract is small enough that filesystem, Redis, IndexedDB, or S3 buckets are easy to add without ceremony. A typical L2 keeps a sidecar (file, table, key/value entry) so `meta()` is cheap.

```ts
import type { IBucket, IBaseMeta } from 'cacheables'

class FileSystemBucket implements IBucket {
  async read<T>(key: string): Promise<{ value: T } | undefined> { /* … */ }
  async write<T>(key: string, value: T, meta?: IBaseMeta): Promise<void> { /* … */ }
  async meta(key: string): Promise<IBaseMeta | undefined> { /* … */ }
  async delete(key: string): Promise<void> { /* … */ }
  async clear(): Promise<void> { /* … */ }
}
```

### Cascade behavior

```ts
const cache = new Cacheable({
  buckets: [new MemoryBucket(), new FileSystemBucket()],
  namespace: 'app',
  policy: 'max-age',
  maxAge: 60_000,
})
```

- **Read**: probe `meta()` on every layer in parallel; the first layer that satisfies the freshness predicate is the hit. Read its value, and back-fill every other layer that is still missing the key — using the hit layer's meta so `storedAt` is preserved everywhere.
- **Miss + resource()**: write to L1 with no meta (L1 synthesizes its own), read meta back from L1, then write to L2..Ln with that exact meta. All layers converge to the same `storedAt`.
- **Stale L1 + fresh L2 (under `max-age`)**: the freshness predicate filters per-layer, so the engine returns the fresh L2 value and back-fills L1.

### Typed metadata (`TMeta`)

`Cacheable` is generic in `TMeta`. Extend it to carry sidecar fields:

```ts
import { Cacheable, type IBaseMeta, type IBucket } from 'cacheables'

interface ETagMeta extends IBaseMeta {
  etag: string
}

class ETagBucket implements IBucket<ETagMeta> {
  // read / write / meta / delete / clear …
}

const cache = new Cacheable<ETagMeta>({
  buckets: [new ETagBucket()],
  namespace: 'app',
})

const meta = await cache.meta('user:42') // typed as ETagMeta | undefined
```

Every bucket passed to the constructor must satisfy `IBucket<ETagMeta>`, and the TypeScript compiler enforces it. The built-in `MemoryBucket` only implements `IBucket<IBaseMeta>`, so it can't be used in a `Cacheable` instance with a custom `TMeta` — write a custom bucket (or wrap `MemoryBucket`) when you need extended metadata.

## Logger

Pass a `logger` to surface what the engine is doing. Without one, the engine is silent.

### `ILogger` contract

```ts
interface ILogger {
  log(message: string): void
}
```

When a `logger` is configured, every `cache.remember(...)` call emits two messages — timing, then hit count:

```
Cacheable "weather": 12ms
Cacheable "weather": hits: 1
```

### Built-in `ConsoleLogger`

Forwards each message to `console.log`. Useful as a default during development.

```ts
import { Cacheable, ConsoleLogger, MemoryBucket } from 'cacheables'

const cache = new Cacheable({
  buckets: [new MemoryBucket()],
  namespace: 'app',
  logger: new ConsoleLogger(),
})
```

### Writing your own logger

Any object with a `log(message: string)` method satisfies `ILogger`, so wrapping an existing logger is a one-liner:

```ts
import pino from 'pino'
import { Cacheable, MemoryBucket, type ILogger } from 'cacheables'

const pinoLogger = pino()
const logger: ILogger = { log: (m) => pinoLogger.info(m) }

const cache = new Cacheable({
  buckets: [new MemoryBucket()],
  namespace: 'app',
  logger,
})
```

The `logger` field on a `Cacheable` instance is mutable — assign a new logger (or `undefined`) at runtime to flip logging on or off.

## Namespacing

`namespace` is required: every bucket call sees keys prefixed with `${namespace}:`. This isolates instances that share the same bucket, so you must pick a namespace at construction time even when only one instance uses a bucket.

```ts
const bucket = new MemoryBucket()
const tenantA = new Cacheable({ buckets: [bucket], namespace: 'tenant-a' })
const tenantB = new Cacheable({ buckets: [bucket], namespace: 'tenant-b' })
```

Two instances can share a bucket without colliding. `delete` and `isCached` respect the namespace; `clear()` wipes the entire underlying bucket (it has no notion of which keys belong to which namespace), so reach for it only when you really mean *everything*.

## Cache Policies

| Policy                          | Behaviour                                                                                                                                                                                                                                                                                              |
|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `cache-only` *(default)*        | Return any cached value; on miss, call `resource()`. Concurrent miss callers share one fetch.                                                                                                                                                                                                          |
| `network-only`                  | Always call `resource()`; concurrent calls each get their own.                                                                                                                                                                                                                                         |
| `network-only-non-concurrent`   | Always call `resource()`, but concurrent calls share one in-flight request.                                                                                                                                                                                                                            |
| `max-age` *(maxAge required)*   | Return cache if `Date.now() - storedAt <= maxAge`, otherwise fetch.                                                                                                                                                                                                                                    |
| `stale-while-revalidate`        | Return the cached value immediately; if `maxAge` is unset or exceeded, fire a background revalidation.                                                                                                                                                                                                 |

```ts
new Cacheable({ buckets: [new MemoryBucket()], namespace: 'app', policy: 'max-age', maxAge: 1_000 })
```

## Migrating from v2 → v3

Breaking changes:

- The class `Cacheables` has been renamed to `Cacheable`. Update imports and `new Cacheables(...)` call sites.
- The `IStorageAdapter` interface has been renamed to `IBucket`, and `MemoryAdapter` to `MemoryBucket`. The contract is unchanged.
- `buckets` is now a **required** constructor option (replaces the v2-style implicit memory store). `new Cacheable()` no longer compiles. Pass at least one bucket, e.g. `new Cacheable({ buckets: [new MemoryBucket()], namespace: 'app' })`.
- The constructor's empty-buckets error message is now `'At least one bucket is required'`.
- The `CacheablesOptions` type has been renamed to `CacheableOptions`.
- `delete(key)` returns `Promise<void>` (was `void`). Add `await`.
- `clear()` returns `Promise<void>` (was `void`). Add `await`.
- `isCached(key)` returns `Promise<boolean>` (was `boolean`). Add `await`.
- `keys()` is **removed**. Enumerating heterogeneous async layers (some non-enumerable, like CDNs) doesn't have a single sensible semantic.
- The `enabled` option is **removed**. If you need to bypass caching, call `resource()` directly instead of `cache.remember()`.
- `Cacheable` is now generic in `TMeta`. Plain `new Cacheable({ buckets, namespace })` defaults to `Cacheable<IBaseMeta>` and is source-compatible at the type level.
- New constructor options: `buckets` (required) and `namespace` (required).
- Any throw from any bucket rejects `remember()`. Previously the in-memory store couldn't fail; this is new strict-error surface for users with custom buckets.
- The `log` and `logTiming` boolean options have been replaced by a single `logger?: ILogger` option. Pass `new ConsoleLogger()` to restore the previous default-on logging, or implement `ILogger` to route messages elsewhere. Timing now ships as a formatted string (`Cacheable "<key>": <Xms>`) instead of `console.time`/`timeEnd`.

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
