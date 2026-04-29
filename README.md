# Cacheables

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language](https://img.shields.io/github/languages/top/grischaerbe/cacheables)
![Build](https://img.shields.io/github/actions/workflow/status/grischaerbe/cacheables/ci.yml?branch=master)

A small, typed cache with composable storage buckets and a handful of cache policies, written in TypeScript.

- **Wrap any async call** with `cache.remember(...)` — `remember` is both getter and setter.
- **Multilayer storage**: stack a fast in-memory L1 with any L2 you write (filesystem, Redis, S3, …). Reads cascade L1 → Ln; on any hit, missing layers are back-filled.
- **Five cache policies**, including `stale-while-revalidate`, with concurrency-safe deduplication where it makes sense.
- **Fully typed**, with a generic `TView` parameter for the bucket's user-facing projection (a URL from a filesystem bucket, a presigned link from S3, …) surfaced via `cache.resolve(...)`.
- **Required namespace prefix** so multiple instances can share a bucket without collisions.
- Helper to build cache keys.
- Works in browser and Node.js. **No dependencies.**

```ts
import { Cacheable, MemoryBucket } from 'cacheables'

const cache = new Cacheable('app', { buckets: [new MemoryBucket()] })

// Cache the parsed JSON, not the Response — a Response body can be
// consumed exactly once, so caching the Response itself would break
// every call after the first .json().
const data = await cache.remember(
  () => fetch('https://some-url.com/api').then((r) => r.json()),
  'key',
)
```

- [Installation](#installation)
- [Usage](#usage)
- [API](#api)
  - [new Cacheable(namespace, options)](#new-cacheablenamespace-options-cacheabletview)
  - [cache.remember(resource, key)](#cacherememberresource-key-promiset)
  - [cache.resolve(resource, key)](#cacheresolveresource-key-promisetview)
  - [cache.delete(key) / cache.clear()](#cachedeletekey-promisevoid--cacheclear-promisevoid)
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
// Cache the parsed JSON rather than the Response object — the Response
// body can only be read once.
const getWeather = () =>
  cache.remember(() => fetch(apiUrl).then((r) => r.json()), 'karlsruhe')

await getWeather() // miss — fetched
await getWeather() // hit — cached
```

## API

### `new Cacheable(namespace, options): Cacheable<TView>`

```ts
new Cacheable<TView = void>(
  namespace: string,
  options: CacheableOptions<TView>,
)

type CacheableOptions<TView = void> = {
  buckets: IBucket<TView>[] // REQUIRED, L1 first
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

Returns the cached value if present (subject to policy); otherwise calls `resource()` and writes to every bucket.

### `cache.resolve(resource, key): Promise<TView>`

Same fresh-or-fetch behavior as `remember`, but returns the L1 bucket's view instead of the producer's value. Use this when the bucket produces a domain-specific projection that callers actually need — a filesystem bucket exposing a local URL after caching the bytes, a CDN bucket returning a presigned link, an IndexedDB bucket returning an `ObjectURL`:

```ts
interface UrlView {
  url: string
}

class FilesystemBucket implements IBucket<UrlView> {
  // read / write / meta / delete / clear …
  async view(key: string): Promise<{ view: UrlView } | undefined> {
    /* return { view: { url: pathFor(key) } } when the entry exists */
  }
}

const cache = new Cacheable<UrlView>('images', {
  buckets: [new FilesystemBucket()],
})

const { url } = await cache.resolve(
  () => fetch(imageUrl).then((r) => r.arrayBuffer()),
  imageUrl,
)
```

`resolve` runs a separate **view-cascade**: the engine probes `meta()` on every layer and, on an L1 hit where no other layer needs back-filling, calls `bucket.view()` directly without ever reading the value. A filesystem bucket holding a 5 MB ArrayBuffer never opens the file on the hot path — only the projection (URL) is materialized.

`resolve` and `remember` share the same in-flight registry: a concurrent pair against the same key triggers `resource()` once. `resolve` honors the cache policy — a stale entry will trigger a producer call (or a background revalidation under `stale-while-revalidate`).

For buckets without a meaningful projection (e.g. the built-in `MemoryBucket`), `TView = void` and `cache.resolve()` resolves to `undefined`.

### `cache.delete(key): Promise<void>` / `cache.clear(): Promise<void>`

`delete` removes the entry from every bucket. `clear` wipes every bucket and the in-flight registry.

## Buckets

A bucket is a single storage tier — memory, Redis, disk, S3, anything you can read and write by key. A `Cacheable` instance holds an ordered list of buckets and cascades reads and writes across them.

### `IBucket` contract

```ts
interface BucketEntryMeta {
  storedAt: number
}

interface IBucket<TView = void> {
  read<T>(key: string): Promise<{ value: T } | undefined>
  write<T>(key: string, value: T, meta: BucketEntryMeta): Promise<void>
  meta(key: string): Promise<BucketEntryMeta | undefined>
  view(key: string): Promise<{ view: TView } | undefined>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
```

The engine carries only `BucketEntryMeta` (i.e. `storedAt`) between buckets. `TView` is what the bucket exposes through `cache.resolve(...)` — it never crosses bucket boundaries.

Rules:

- `meta` MUST be cheap. The engine probes it on every layer for every read. A typical L2 keeps a sidecar (file, table, key/value entry) so probes don't hit the value blob.
- `read` returns `undefined` for absence and `{ value }` for presence — the wrapper lets buckets store entries whose value is itself `undefined` without colliding with the absence signal.
- `write` MUST persist `meta.storedAt` verbatim. The engine always supplies a meta; there is no synthesis branch.
- `view` returns `undefined` for absence and `{ view }` for presence. The same wrapper pattern as `read` lets `TView = void` buckets distinguish "entry present, no projection" (`{ view: undefined }`) from "entry absent" (`undefined`). The engine treats absence after a meta-probe hit as a race and heals it by running the producer; absence after a successful cascade write is a strict-mode error and the engine throws.
- `clear` MUST remove every entry the bucket manages.
- Any throw from any bucket rejects the surrounding `remember()` / `resolve()` call.

### Cascade behavior

```ts
const cache = new Cacheable('app', {
  buckets: [new MemoryBucket(), new FileSystemBucket()],
  policy: 'max-age',
  maxAge: 60_000,
})
```

- **Read (`cache.remember`)**: probe `meta()` on every layer in parallel; the first layer satisfying the freshness predicate is the hit. Read its value, then back-fill every layer that is missing OR stale, using the hit layer's `storedAt` verbatim.
- **Read (`cache.resolve`)**: probe `meta()` on every layer; on an L1 hit where no other layer needs back-filling, call `bucket.view()` directly without reading the value. When a deeper layer hits or upper layers need refilling, the value is read from the hit layer to fill the others, then L1's view is returned.
- **Miss + `resource()`**: the engine mints a single `{ storedAt }` and writes to every layer in parallel — all layers converge on the same `storedAt`.
- **Stale L1 + fresh L2** (under `max-age`): the freshness predicate filters per-layer, so the engine returns the fresh L2 value AND refreshes L1 with L2's value and `storedAt` verbatim.

### Built-in `MemoryBucket`

Ships with the package; covers the common in-memory case.

```ts
import { Cacheable, MemoryBucket } from 'cacheables'

const cache = new Cacheable('app', { buckets: [new MemoryBucket()] })
```

### Writing your own bucket

Implement `IBucket`. The contract is small enough that filesystem, Redis, IndexedDB, or S3 buckets are easy to add.

```ts
import type { IBucket, BucketEntryMeta } from 'cacheables'

class FileSystemBucket implements IBucket {
  async read<T>(key: string): Promise<{ value: T } | undefined> {
    /* … */
  }
  async write<T>(key: string, value: T, meta: BucketEntryMeta): Promise<void> {
    /* persist the value AND meta.storedAt verbatim */
  }
  async meta(key: string): Promise<BucketEntryMeta | undefined> {
    /* … */
  }
  async view(key: string): Promise<{ view: void } | undefined> {
    /* no projection — return { view: undefined } if the entry exists */
  }
  async delete(key: string): Promise<void> {
    /* … */
  }
  async clear(): Promise<void> {
    /* … */
  }
}
```

### Bucket views (`TView`)

`IBucket<TView>` is generic in `TView` — the projection the bucket exposes through `cache.resolve(...)`. A filesystem bucket caching remote bytes can publish the local URL it stored them at:

```ts
import { Cacheable, type IBucket, type BucketEntryMeta } from 'cacheables'

interface UrlView {
  url: string
}

class FilesystemBucket implements IBucket<UrlView> {
  async read<T>(key: string): Promise<{ value: T } | undefined> {
    /* … */
  }
  async write<T>(key: string, value: T, meta: BucketEntryMeta): Promise<void> {
    /* persist value to disk under a deterministic path */
  }
  async meta(key: string): Promise<BucketEntryMeta | undefined> {
    /* read the sidecar */
  }
  async view(key: string): Promise<{ view: UrlView } | undefined> {
    /* return { view: { url: pathFor(key) } } when the entry exists */
  }
  async delete(key: string): Promise<void> {
    /* … */
  }
  async clear(): Promise<void> {
    /* … */
  }
}

const cache = new Cacheable<UrlView>('images', {
  buckets: [new FilesystemBucket()],
})

const { url } = await cache.resolve(() => fetchBytes(remoteUrl), remoteUrl)
```

Every bucket passed to the constructor must satisfy `IBucket<UrlView>`, enforced by the compiler. The built-in `MemoryBucket` is `IBucket<void>`, so it can't be used in a `Cacheable` with a non-`void` `TView` — write a bucket whose `view(key)` produces the projection you want.

## Cache Policies

The policy is set once on the constructor and applies to every `remember()` and `resolve()` call on that instance. Two mechanics matter across policies:

- **Freshness**: whether a cached value qualifies for return without re-fetching. Only `max-age` and `stale-while-revalidate` look at `storedAt`.
- **In-flight deduplication**: when two callers ask for the same key concurrently, an instance keeps a per-key promise so only one `resource()` runs and both callers receive its result. `remember` and `resolve` share that registry — a concurrent pair against the same key triggers one `resource()` call. Dedup is policy-dependent (see each section below).

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

Every `cache.remember(...)` and `cache.resolve(...)` emits one message, tagged `HIT` or `MISS` with the elapsed time. The format is `Cacheable "${namespace}:${key}": …` so two namespaces sharing one logger remain distinguishable:

```
Cacheable "weather-data:karlsruhe": MISS 12ms
Cacheable "weather-data:karlsruhe": HIT 0.2ms
```

The built-in `consoleLogger` forwards to `console.log`:

```ts
import { Cacheable, consoleLogger, MemoryBucket } from 'cacheables'

const cache = new Cacheable('app', {
  buckets: [new MemoryBucket()],
  logger: consoleLogger,
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

`delete` respects the namespace; `clear()` wipes the entire underlying bucket — it has no notion of which keys belong to which namespace. Reach for `clear()` only when you mean _everything_.

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
import { Cacheable, MemoryBucket, consoleLogger } from 'cacheables'

const cache = new Cacheable('weather', {
  buckets: [new MemoryBucket()],
  policy: 'max-age',
  maxAge: 5_000,
  logger: consoleLogger,
})

await cache.remember(() => fetch(url).then((r) => r.json()), 'weather')
```

Breaking changes:

- **Class renamed** `Cacheables` → `Cacheable`. Update imports and `new Cacheables(...)` call sites.
- **`Cacheables.key(...)` removed.** The static key-joining helper is gone; build keys with template literals or `[...].join(':')`.
- **Method renamed** `cache.cacheable(...)` → `cache.remember(...)`.
- **Cache policy moved to the constructor.** v2 took `cachePolicy` and `maxAge` as a per-call third argument; v3 has no per-call options. Pass `policy` (and `maxAge` where required) once on `new Cacheable(namespace, { ... })`. The field is `policy`, not `cachePolicy`. A single instance now serves a single policy — split into multiple instances if you previously mixed policies on one cache.
- **`buckets` is required** (replaces v2's implicit in-memory store). `new Cacheable()` no longer compiles. `new Cacheable('app', { buckets: [new MemoryBucket()] })` reproduces the v2 default.
- **`namespace` is required and positional.** It's the constructor's first argument, prefixed onto every bucket key as `${namespace}:`. Pick one even if only one instance writes to the bucket.
- **`enabled` option removed.** If you need to bypass the cache, call `resource()` directly instead of `cache.remember(...)`.
- **`keys()` removed.** Enumerating heterogeneous async layers (some non-enumerable, like CDNs) has no single sensible semantic.
- **`delete` and `clear` are async.** They now return `Promise<void>` — add `await`.
- **`isCached` removed.** v3 has no public presence-check API; if you need one, query your bucket directly (e.g. `await bucket.meta(fullKey)`).
- **`log` / `logTiming` replaced by `logger`.** Pass the exported `consoleLogger` singleton to restore the previous default-on logging, or implement `ILogger` to route messages elsewhere. Each `remember()` call emits a single formatted message (`Cacheable "<namespace>:<key>": HIT|MISS <Xms>`) instead of `console.time` / `timeEnd`.
- **Options types reshaped.** v2's `CacheOptions` (constructor) and `CacheableOptions` (per-call) are gone. v3's only exported options type is `CacheableOptions` — same name as v2's per-call type, completely different shape (it now carries `buckets`, `policy`, and `logger`; `namespace` is the constructor's first positional argument). v2's `CacheOptions` is no longer exported.
- **Buckets can throw.** Any throw from any bucket rejects `remember()`. v2's in-memory store couldn't fail, so this is a new error surface to be aware of once you wire up a custom bucket.

What's new:

- **Multilayer storage.** Pass several buckets to compose tiers (e.g. `[memory, filesystem]`); reads cascade L1 → Ln and back-fill missing layers on every hit.
- **Bucket views.** `Cacheable<TView>` is generic; a bucket can publish a domain-specific projection (a local URL, a presigned link, an `ObjectURL`) via its `view()` method, returned by `cache.resolve(...)`. Plain `new Cacheable(namespace, { buckets })` defaults to `Cacheable<void>` and needs no type changes.

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
