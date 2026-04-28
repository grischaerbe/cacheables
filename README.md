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

const cache = new Cacheable('app', { buckets: [new MemoryBucket()] })

cache.remember(() => fetch('https://some-url.com/api'), 'key')
```

- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
  - [new Cacheable(namespace, options)](#new-cacheablenamespace-options-cacheabletmeta)
  - [cache.remember(resource, key)](#cacherememberresource-key-promiset)
  - [cache.delete(key)](#cachedeletekey-promisevoid)
  - [cache.clear()](#cacheclear-promisevoid)
  - [cache.meta(key)](#cachemetakey-promisetmeta--undefined)
  - [Cacheable.key(...args)](#cacheablekeyargs-string)
- [Buckets](#buckets)
  - [`IBucket` contract](#ibucket-contract)
  - [Built-in `MemoryBucket`](#built-in-memorybucket)
  - [Writing your own bucket](#writing-your-own-bucket)
  - [Cascade behavior](#cascade-behavior)
  - [Typed metadata (`TMeta`)](#typed-metadata-tmeta)
- [Logger](#logger)
  - [`ILogger` contract](#ilogger-contract)
  - [Built-in `ConsoleLogger`](#built-in-consolelogger)
  - [Writing your own logger](#writing-your-own-logger)
- [Namespacing](#namespacing)
- [Cache Policies](#cache-policies)
- [Migrating from v2 → v3](#migrating-from-v2--v3)
- [License](#license)

## Installation

```bash
npm install cacheables
```

## Usage

```ts
import { Cacheable, MemoryBucket } from 'cacheables'

const apiUrl = 'https://goweather.herokuapp.com/weather/Karlsruhe'

const cache = new Cacheable('weather', {
  buckets: [new MemoryBucket()],
  policy: 'max-age',
  maxAge: 5_000,
})

const getWeather = () => cache.remember(() => fetch(apiUrl), 'weather')

await getWeather() // miss — fetched
await getWeather() // hit — cached
```

`remember` is both getter and setter. The first time a key is requested it calls the resource and stores the result in every configured bucket; subsequent reads cascade through the buckets until one returns a hit.

## API

### `new Cacheable(namespace, options): Cacheable<TMeta>`

```ts
new Cacheable<TMeta extends IBaseMeta = IBaseMeta>(
  namespace: string,
  options: CacheableOptions<TMeta>,
)

type CacheableOptions<TMeta extends IBaseMeta = IBaseMeta> = {
  buckets: IBucket<TMeta>[] // REQUIRED, L1 first
  logger?: ILogger // default: undefined (no logging)
} & (
  | { policy?: 'cache-only' } // default
  | { policy: 'network-only' }
  | { policy: 'network-only-non-concurrent' }
  | { policy: 'max-age'; maxAge: number }
  | { policy: 'stale-while-revalidate'; maxAge?: number }
)
```

`namespace` is prefixed onto every key passed to buckets as `${namespace}:${key}`, isolating instances that share a bucket. `buckets` must be a non-empty array; the constructor throws `Error('At least one bucket is required')` otherwise. The first bucket is L1 (fastest, queried first); the rest form deeper layers.

### `cache.remember(resource, key): Promise<T>`

Resolves to the cached value if present (subject to policy), otherwise calls `resource()` and stores the result in every bucket.

### `cache.delete(key): Promise<void>`

Deletes the entry from every bucket.

### `cache.clear(): Promise<void>`

Clears every bucket and the in-flight registry.

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

const cache = new Cacheable('app', { buckets: [new MemoryBucket()] })
```

### Writing your own bucket

Implement `IBucket`. The contract is small enough that filesystem, Redis, IndexedDB, or S3 buckets are easy to add without ceremony. A typical L2 keeps a sidecar (file, table, key/value entry) so `meta()` is cheap.

```ts
import type { IBucket, IBaseMeta } from 'cacheables'

class FileSystemBucket implements IBucket {
  async read<T>(key: string): Promise<{ value: T } | undefined> {
    /* … */
  }
  async write<T>(key: string, value: T, meta?: IBaseMeta): Promise<void> {
    /* … */
  }
  async meta(key: string): Promise<IBaseMeta | undefined> {
    /* … */
  }
  async delete(key: string): Promise<void> {
    /* … */
  }
  async clear(): Promise<void> {
    /* … */
  }
}
```

### Cascade behavior

```ts
const cache = new Cacheable('app', {
  buckets: [new MemoryBucket(), new FileSystemBucket()],
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

const cache = new Cacheable<ETagMeta>('app', {
  buckets: [new ETagBucket()],
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

When a `logger` is configured, every `cache.remember(...)` call emits one message tagged `HIT` or `MISS` with the elapsed time:

```
Cacheable "weather": MISS 12ms
Cacheable "weather": HIT 0.2ms
```

### Built-in `ConsoleLogger`

Forwards each message to `console.log`. Useful as a default during development.

```ts
import { Cacheable, ConsoleLogger, MemoryBucket } from 'cacheables'

const cache = new Cacheable('app', {
  buckets: [new MemoryBucket()],
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

const cache = new Cacheable('app', {
  buckets: [new MemoryBucket()],
  logger,
})
```

The `logger` field on a `Cacheable` instance is mutable — assign a new logger (or `undefined`) at runtime to flip logging on or off.

## Namespacing

`namespace` is required and is the constructor's first positional argument: every bucket call sees keys prefixed with `${namespace}:`. This isolates instances that share the same bucket, so you must pick a namespace at construction time even when only one instance uses a bucket.

```ts
const bucket = new MemoryBucket()
const tenantA = new Cacheable('tenant-a', { buckets: [bucket] })
const tenantB = new Cacheable('tenant-b', { buckets: [bucket] })
```

Two instances can share a bucket without colliding. `delete` and `meta` respect the namespace; `clear()` wipes the entire underlying bucket (it has no notion of which keys belong to which namespace), so reach for it only when you really mean _everything_.

## Cache Policies

| Policy                        | Behaviour                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `cache-only` _(default)_      | Return any cached value; on miss, call `resource()`. Concurrent miss callers share one fetch.          |
| `network-only`                | Always call `resource()`; concurrent calls each get their own.                                         |
| `network-only-non-concurrent` | Always call `resource()`, but concurrent calls share one in-flight request.                            |
| `max-age` _(maxAge required)_ | Return cache if `Date.now() - storedAt <= maxAge`, otherwise fetch.                                    |
| `stale-while-revalidate`      | Return the cached value immediately; if `maxAge` is unset or exceeded, fire a background revalidation. |

```ts
new Cacheable('app', {
  buckets: [new MemoryBucket()],
  policy: 'max-age',
  maxAge: 1_000,
})
```

## Migrating from v2 → v3

v2 was an in-memory cache with per-call options and a synchronous surface. v3 introduces pluggable storage (buckets), required namespacing, an instance-level cache policy, and a fully async API.

Before / after:

```ts
// v2
import { Cacheables } from 'cacheables'

const cache = new Cacheables({ log: true, logTiming: true })

await cache.cacheable(() => fetch(url), 'weather', {
  cachePolicy: 'max-age',
  maxAge: 5_000,
})
```

```ts
// v3
import { Cacheable, MemoryBucket, ConsoleLogger } from 'cacheables'

const cache = new Cacheable('weather', {
  buckets: [new MemoryBucket()],
  policy: 'max-age',
  maxAge: 5_000,
  logger: new ConsoleLogger(),
})

await cache.remember(() => fetch(url), 'weather')
```

Breaking changes:

- **Class renamed** `Cacheables` → `Cacheable`. Update imports and `new Cacheables(...)` call sites. The static helper moves with it: `Cacheables.key(...)` → `Cacheable.key(...)` (behaviour unchanged).
- **Method renamed** `cache.cacheable(...)` → `cache.remember(...)`.
- **Cache policy moved to the constructor.** v2 took `cachePolicy` and `maxAge` as a per-call third argument; v3 has no per-call options. Pass `policy` (and `maxAge` where required) once on `new Cacheable(namespace, { ... })`. The field is `policy`, not `cachePolicy`. A single instance now serves a single policy — split into multiple instances if you previously mixed policies on one cache.
- **`buckets` is required** (replaces v2's implicit in-memory store). `new Cacheable()` no longer compiles. `new Cacheable('app', { buckets: [new MemoryBucket()] })` reproduces the v2 default.
- **`namespace` is required and positional.** It's the constructor's first argument, prefixed onto every bucket key as `${namespace}:`. Pick one even if only one instance writes to the bucket.
- **`enabled` option removed.** If you need to bypass the cache, call `resource()` directly instead of `cache.remember(...)`.
- **`keys()` removed.** Enumerating heterogeneous async layers (some non-enumerable, like CDNs) has no single sensible semantic.
- **`delete` and `clear` are async.** They now return `Promise<void>` — add `await`.
- **`isCached` removed.** Use `cache.meta(key)` instead — it returns `undefined` when the key is absent and the meta object otherwise.
- **`log` / `logTiming` replaced by `logger`.** Pass `new ConsoleLogger()` to restore the previous default-on logging, or implement `ILogger` to route messages elsewhere. Each `remember()` call emits a single formatted message (`Cacheable "<key>": HIT|MISS <Xms>`) instead of `console.time` / `timeEnd`.
- **Options types reshaped.** v2's `CacheOptions` (constructor) and `CacheableOptions` (per-call) are gone. v3's constructor options type is `CacheableOptions` — same name as v2's per-call type, completely different shape (it now carries `buckets`, `policy`, and `logger`; `namespace` is the constructor's first positional argument).
- **Buckets can throw.** Any throw from any bucket rejects `remember()`. v2's in-memory store couldn't fail, so this is a new error surface to be aware of once you wire up a custom bucket.

What's new:

- **Multilayer storage.** Pass several buckets to compose tiers (e.g. `[memory, filesystem]`); reads cascade L1 → Ln and back-fill missing layers on every hit.
- **Typed sidecar metadata.** `Cacheable<TMeta>` is generic; bucket implementations can persist fields like `etag` or `ttl` and `cache.meta(key)` returns them typed. Plain `new Cacheable(namespace, { buckets })` defaults to `Cacheable<IBaseMeta>` and needs no type changes.

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
