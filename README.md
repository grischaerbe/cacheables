# Cacheables

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language](https://img.shields.io/github/languages/top/grischaerbe/cacheables)
![Build](https://img.shields.io/github/workflow/status/grischaerbe/cacheables/Node.js%20Package)

A small, typed cache with composable storage buckets and a handful of cache policies, written in TypeScript.

- **Wrap any async call** with `cache.remember(...)` — `remember` is both getter and setter.
- **Multilayer storage**: stack a fast in-memory L1 with any L2 you write (filesystem, Redis, S3, …). Reads cascade L1 → Ln; on any hit, missing layers are back-filled.
- **Five cache policies**, including `stale-while-revalidate`, with concurrency-safe deduplication where it makes sense.
- **Fully typed**, with a generic `TMeta` parameter for sidecar metadata (etag, ttl, version, …).
- **Required namespace prefix** so multiple instances can share a bucket without collisions.
- Helper to build cache keys.
- Works in browser and Node.js. **No dependencies.**

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
  - [cache.delete(key) / cache.clear()](#cachedeletekey-promisevoid--cacheclear-promisevoid)
  - [cache.meta(key)](#cachemetakey-promisetmeta--undefined)
  - [Cacheable.key(...args)](#cacheablekeyargs-string)
- [Buckets](#buckets)
- [Cache Policies](#cache-policies)
  - [`cache-only` (default)](#cache-only-default)
  - [`network-only`](#network-only)
  - [`network-only-non-concurrent`](#network-only-non-concurrent)
  - [`max-age`](#max-age)
  - [`stale-while-revalidate`](#stale-while-revalidate)
- [Logger](#logger)
- [Namespacing](#namespacing)
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

// 'weather-data' is the namespace — every key is stored under `weather-data:<key>`.
// `buckets` is the layered storage stack; the first entry is L1.
// `policy: 'max-age'` returns the cached value while it is younger than
// `maxAge` (in ms), and re-fetches when it has aged past that.
const cache = new Cacheable('weather-data', {
  buckets: [new MemoryBucket()],
  policy: 'max-age',
  maxAge: 5_000,
})

// `remember` is both getter and setter: on a miss it calls the resource
// and writes to every bucket; on a hit it returns the cached value.
const getWeather = () => cache.remember(() => fetch(apiUrl), 'karlsruhe')

await getWeather() // miss — fetched
await getWeather() // hit — cached
```

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

`namespace` is prefixed onto every key as `${namespace}:${key}`, isolating instances that share a bucket. `buckets` must be a non-empty array (the constructor throws `Error('At least one bucket is required')` otherwise); the first bucket is L1, the rest form deeper layers.

### `cache.remember(resource, key): Promise<T>`

Resolves to the cached value if present (subject to policy); otherwise calls `resource()` and writes to every bucket.

### `cache.delete(key): Promise<void>` / `cache.clear(): Promise<void>`

`delete` removes the entry from every bucket. `clear` wipes every bucket and the in-flight registry. Both are async — `await` them.

### `cache.meta(key): Promise<TMeta | undefined>`

Returns the meta from the highest-priority layer that has the key, or `undefined` if no layer has it. Useful to inspect sidecar fields (`etag`, `ttl`, …) and to test for presence.

### `Cacheable.key(...args): string`

Joins parts with `:`.

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

- `meta` MUST be cheap. The engine probes it on every layer for every read. A typical L2 keeps a sidecar (file, table, key/value entry) so probes don't hit the value blob.
- `read` returns `undefined` for absence and `{ value }` for presence — the wrapper lets buckets store entries whose value is itself `undefined` without colliding with the absence signal.
- When `write` receives a `meta`, the bucket MUST persist `meta.storedAt` verbatim (other fields MAY be transformed). This keeps `max-age` semantics coherent across layers.
- When `write` is called with no `meta`, the bucket MUST synthesize one with `storedAt: Date.now()`.
- `clear` MUST remove every entry the bucket manages.
- Any throw from any bucket rejects the surrounding `remember()` call. There is no per-bucket error suppression.

### Cascade behavior

```ts
const cache = new Cacheable('app', {
  buckets: [new MemoryBucket(), new FileSystemBucket()],
  policy: 'max-age',
  maxAge: 60_000,
})
```

- **Read**: probe `meta()` on every layer in parallel; the first layer satisfying the freshness predicate is the hit. Read its value, then back-fill every layer above and below that is still missing the key, using the hit layer's meta — `storedAt` is preserved everywhere.
- **Miss + `resource()`**: write to L1 with no meta (L1 synthesizes its own), read meta back from L1, then write to L2..Ln with that exact meta. All layers converge on the same `storedAt`.
- **Stale L1 + fresh L2** (under `max-age`): the freshness predicate filters per-layer, so the engine returns the fresh L2 value and back-fills L1.

### Built-in `MemoryBucket`

Ships with the package; covers the common in-memory case.

```ts
import { Cacheable, MemoryBucket } from 'cacheables'

const cache = new Cacheable('app', { buckets: [new MemoryBucket()] })
```

### Writing your own bucket

Implement `IBucket`. The contract is small enough that filesystem, Redis, IndexedDB, or S3 buckets are easy to add.

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

### Typed metadata (`TMeta`)

`Cacheable` is generic in `TMeta`. Extend `IBaseMeta` to carry sidecar fields:

```ts
import { Cacheable, type IBaseMeta, type IBucket } from 'cacheables'

interface ETagMeta extends IBaseMeta {
  etag: string
}

class ETagBucket implements IBucket<ETagMeta> {
  // read / write / meta / delete / clear …
}

const cache = new Cacheable<ETagMeta>('app', { buckets: [new ETagBucket()] })

const meta = await cache.meta('user:42') // typed as ETagMeta | undefined
```

Every bucket passed to the constructor must satisfy `IBucket<ETagMeta>`, enforced by the compiler. The built-in `MemoryBucket` only implements `IBucket<IBaseMeta>`, so it can't be used in a `Cacheable` instance with a custom `TMeta` — write a custom bucket (or wrap `MemoryBucket`) when you need extended metadata.

## Cache Policies

The policy is set once on the constructor and applies to every `remember()` call on that instance. Two mechanics matter across policies:

- **Freshness**: whether a cached value qualifies for return without re-fetching. Only `max-age` and `stale-while-revalidate` look at `storedAt`.
- **In-flight deduplication**: when two callers ask for the same key concurrently, an instance keeps a per-key promise so only one `resource()` runs and both callers receive its result. Dedup is policy-dependent (see each section below).

| Policy                                                        | Returns cached value                 | Calls `resource()`                               | In-flight dedup |
| ------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------ | --------------- |
| [`cache-only`](#cache-only-default) _(default)_               | Always, if present                   | Only on miss                                     | Yes             |
| [`network-only`](#network-only)                               | Never                                | Every call                                       | No              |
| [`network-only-non-concurrent`](#network-only-non-concurrent) | Never                                | Every call (one per concurrent burst)            | Yes             |
| [`max-age`](#max-age)                                         | If `Date.now() - storedAt <= maxAge` | On miss or expiry                                | Yes             |
| [`stale-while-revalidate`](#stale-while-revalidate)           | Always, if present (even stale)      | On miss, or in background when `maxAge` exceeded | Yes             |

### `cache-only` _(default)_

Returns any cached value, regardless of age. On miss, calls `resource()` once and writes to every bucket. Concurrent miss callers share one in-flight `resource()` call.

```ts
const cache = new Cacheable('app', {
  buckets: [new MemoryBucket()],
  // policy: 'cache-only' (the default — can be omitted)
})

const u = () => cache.remember(() => fetchUser(1), 'user:1')

await u() // miss — fetches once, writes
await u() // hit — returns cached value, no fetch

// Concurrent miss: a single fetch is shared across both awaiters.
await Promise.all([u(), u()])
```

Use this policy when the data is effectively immutable for the lifetime of the cache (e.g. content addressed by hash), or when you invalidate keys yourself with `cache.delete(key)`.

### `network-only`

Always calls `resource()`, always overwrites the cache. **No deduplication** — concurrent callers each fire their own `resource()`. The cache exists only to seed reads from sibling instances or to populate downstream layers.

```ts
const cache = new Cacheable('app', {
  buckets: [new MemoryBucket()],
  policy: 'network-only',
})

// Both calls fetch in parallel; both writes land on the cache.
await Promise.all([
  cache.remember(() => fetchUser(1), 'user:1'),
  cache.remember(() => fetchUser(1), 'user:1'),
])
```

Use this policy when stale data is unacceptable and concurrent calls must not be coalesced — for instance, side-effecting POSTs.

### `network-only-non-concurrent`

Always calls `resource()`, always overwrites the cache, **but** concurrent callers share one in-flight request. Equivalent to `network-only` for serial calls; equivalent to `cache-only`'s dedup behavior for concurrent calls.

```ts
const cache = new Cacheable('app', {
  buckets: [new MemoryBucket()],
  policy: 'network-only-non-concurrent',
})

// One fetch shared across the three concurrent awaiters; one write to the cache.
const [a, b, c] = await Promise.all([
  cache.remember(() => fetchUser(1), 'user:1'),
  cache.remember(() => fetchUser(1), 'user:1'),
  cache.remember(() => fetchUser(1), 'user:1'),
])
// Subsequent calls fetch again; this policy never returns the previously cached value.
```

Use this policy when you always want fresh data but want concurrent callers to share a single fetch.

### `max-age`

Returns the cached value if `Date.now() - meta.storedAt <= maxAge`, otherwise calls `resource()` and overwrites the cache. Concurrent miss/expired callers share one in-flight `resource()`. The freshness predicate runs per-layer during the cascade probe, so a stale L1 with a fresh L2 yields a hit on L2 and a back-fill of L1.

```ts
const cache = new Cacheable('app', {
  buckets: [new MemoryBucket()],
  policy: 'max-age',
  maxAge: 5_000, // 5 seconds
})

await cache.remember(() => fetchUser(1), 'user:1') // miss — fetches
await cache.remember(() => fetchUser(1), 'user:1') // hit (within 5s)

// 6 seconds later …
await cache.remember(() => fetchUser(1), 'user:1') // expired — re-fetches, overwrites
```

Multilayer note: a stale L1 doesn't force a network call when L2 still has a fresh value:

```ts
const cache = new Cacheable('app', {
  buckets: [new MemoryBucket(/* short-lived */), new FileSystemBucket()],
  policy: 'max-age',
  maxAge: 60_000,
})
// L1 evicts after 10s but L2 still has a value with storedAt 30s ago:
// the engine returns the L2 value and back-fills L1 with the same storedAt.
```

Use this policy when data has a known freshness window and a re-fetch past that window is acceptable.

### `stale-while-revalidate`

Returns the cached value immediately when it exists, **even if stale**. If `maxAge` is unset _or_ exceeded, fires a background `resource()` call to refresh — the current caller does not wait for it. With no cached value, it behaves like `network-only-non-concurrent` (caller waits, concurrent callers dedup).

```ts
const cache = new Cacheable('app', {
  buckets: [new MemoryBucket()],
  policy: 'stale-while-revalidate',
  maxAge: 5_000, // optional — without it, every read triggers a background revalidation
})

await cache.remember(() => fetchUser(1), 'user:1') // miss — caller waits

// Within 5s: pure cache hit, no revalidation.
await cache.remember(() => fetchUser(1), 'user:1')

// After 5s: returns stale value immediately, kicks off a background fetch
// that overwrites the cache when it resolves.
const stale = await cache.remember(() => fetchUser(1), 'user:1')
```

Background revalidation errors are swallowed (the stale value has already been served). Concurrent stale reads share one revalidation.

Use this policy when latency matters more than absolute freshness — e.g. dashboards where a slightly outdated reading beats a loading spinner.

## Logger

Pass a `logger` to surface what the engine is doing. Without one, the engine is silent.

```ts
interface ILogger {
  log(message: string): void
}
```

Every `cache.remember(...)` emits two messages — timing, then hit count:

```
Cacheable "weather": 12ms
Cacheable "weather": hits: 1
```

The built-in `ConsoleLogger` forwards to `console.log`:

```ts
import { Cacheable, ConsoleLogger, MemoryBucket } from 'cacheables'

const cache = new Cacheable('app', {
  buckets: [new MemoryBucket()],
  logger: new ConsoleLogger(),
})
```

Any object with a `log(message: string)` method satisfies `ILogger`, so wrapping an existing logger is a one-liner:

```ts
import pino from 'pino'
import { Cacheable, MemoryBucket, type ILogger } from 'cacheables'

const pinoLogger = pino()
const logger: ILogger = { log: (m) => pinoLogger.info(m) }

const cache = new Cacheable('app', { buckets: [new MemoryBucket()], logger })
```

The `logger` field on a `Cacheable` instance is mutable — assign a new logger (or `undefined`) at runtime to flip logging on or off.

## Namespacing

`namespace` is the constructor's first positional argument and is required. Every bucket call sees keys prefixed with `${namespace}:`, so two instances can safely share a bucket:

```ts
const bucket = new MemoryBucket()
const tenantA = new Cacheable('tenant-a', { buckets: [bucket] })
const tenantB = new Cacheable('tenant-b', { buckets: [bucket] })
```

`delete` and `meta` respect the namespace; `clear()` wipes the entire underlying bucket — it has no notion of which keys belong to which namespace. Reach for `clear()` only when you mean _everything_.

## Migrating from v2 → v3

v2 was an in-memory cache with per-call options and a synchronous surface. v3 introduces pluggable storage (buckets), required namespacing, an instance-level cache policy, and a fully async API.

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
- **`log` / `logTiming` replaced by `logger`.** Pass `new ConsoleLogger()` to restore the previous default-on logging, or implement `ILogger` to route messages elsewhere. Timing now ships as a formatted string (`Cacheable "<key>": <Xms>`) instead of `console.time` / `timeEnd`.
- **Options types reshaped.** v2's `CacheOptions` (constructor) and `CacheableOptions` (per-call) are gone. v3's constructor options type is `CacheableOptions` — same name as v2's per-call type, completely different shape (it now carries `buckets`, `policy`, and `logger`; `namespace` is the constructor's first positional argument).
- **Buckets can throw.** Any throw from any bucket rejects `remember()`. v2's in-memory store couldn't fail, so this is a new error surface to be aware of once you wire up a custom bucket.

What's new:

- **Multilayer storage.** Pass several buckets to compose tiers (e.g. `[memory, filesystem]`); reads cascade L1 → Ln and back-fill missing layers on every hit.
- **Typed sidecar metadata.** `Cacheable<TMeta>` is generic; bucket implementations can persist fields like `etag` or `ttl` and `cache.meta(key)` returns them typed. Plain `new Cacheable(namespace, { buckets })` defaults to `Cacheable<IBaseMeta>` and needs no type changes.

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
