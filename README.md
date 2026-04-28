# Cacheables

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Language](https://img.shields.io/github/languages/top/grischaerbe/cacheables)
![Build](https://img.shields.io/github/workflow/status/grischaerbe/cacheables/Node.js%20Package)

A small, typed cache with composable storage adapters and a handful of cache policies, written in TypeScript.

- Elegant syntax: **wrap existing async calls** with `cache.remember(...)`.
- **Multilayer storage**: compose a fast in-memory L1 with any L2 you write (filesystem, Redis, S3, …). Reads cascade L1 → Ln; on any hit the engine fills missing layers.
- **Fully typed results**, including a generic `TMeta` parameter for sidecar metadata.
- Supports different **cache policies**.
- Helper to build cache keys.
- Optional **namespace** prefix so multiple instances can share an adapter without collisions.
- Works in the browser and Node.js.
- **No dependencies**.

```ts
import { Cacheables, MemoryAdapter } from 'cacheables'

const cache = new Cacheables({ adapters: [new MemoryAdapter()] })

cache.remember(() => fetch('https://some-url.com/api'), 'key')
```

* [Installation](#installation)
* [Quickstart](#quickstart)
* [Usage](#usage)
* [API](#api)
  * [new Cacheables(options)](#new-cacheablesoptions-cacheablestmeta)
  * [cache.remember(resource, key)](#cacherememberresource-key-promiset)
  * [cache.delete(key)](#cachedeletekey-promisevoid)
  * [cache.clear()](#cacheclear-promisevoid)
  * [cache.isCached(key)](#cacheiscachedkey-promiseboolean)
  * [cache.meta(key)](#cachemetakey-promisetmeta--undefined)
  * [Cacheables.key(...args)](#cacheableskeyargs-string)
* [Storage adapters](#storage-adapters)
  * [`IStorageAdapter` contract](#istorageadapter-contract)
  * [Built-in `MemoryAdapter`](#built-in-memoryadapter)
  * [Writing your own adapter](#writing-your-own-adapter)
  * [Cascade behavior](#cascade-behavior)
  * [Typed metadata (`TMeta`)](#typed-metadata-tmeta)
* [Namespacing](#namespacing)
* [Cache Policies](#cache-policies)
* [Migrating from v3 → v4](#migrating-from-v3--v4)
* [License](#license)

## Installation

```bash
npm install cacheables
```

## Usage

```ts
import { Cacheables, MemoryAdapter } from 'cacheables'

const apiUrl = 'https://goweather.herokuapp.com/weather/Karlsruhe'

const cache = new Cacheables({
  adapters: [new MemoryAdapter()],
  policy: 'max-age',
  maxAge: 5_000,
})

const getWeather = () => cache.remember(() => fetch(apiUrl), 'weather')

await getWeather() // miss — fetched
await getWeather() // hit — cached
```

`remember` is both getter and setter. The first time a key is requested it calls the resource and stores the result in every configured adapter; subsequent reads cascade through the adapters until one returns a hit.

## API

### `new Cacheables(options): Cacheables<TMeta>`

```ts
type CacheablesOptions<TMeta extends IBaseMeta = IBaseMeta> = {
  adapters: IStorageAdapter<TMeta>[]   // REQUIRED, L1 first
  namespace?: string                   // adapter keys become `${namespace}:${key}`
  enabled?: boolean                    // default: true
  log?: boolean                        // default: false
  logTiming?: boolean                  // default: false
} & (
  | { policy?: 'cache-only' }                                // default
  | { policy: 'network-only' }
  | { policy: 'network-only-non-concurrent' }
  | { policy: 'max-age', maxAge: number }
  | { policy: 'stale-while-revalidate', maxAge?: number }
)
```

`adapters` must be a non-empty array; the constructor throws `Error('At least one storage adapter is required')` otherwise. The first adapter is L1 (fastest, queried first); the rest form deeper layers.

### `cache.remember(resource, key): Promise<T>`

Resolves to the cached value if present (subject to policy), otherwise calls `resource()` and stores the result in every adapter.

### `cache.delete(key): Promise<void>`

Deletes the entry from every adapter.

### `cache.clear(): Promise<void>`

Clears every adapter and the in-flight registry.

### `cache.isCached(key): Promise<boolean>`

`true` if any layer reports the key (existence-only — does not consider freshness).

### `cache.meta(key): Promise<TMeta | undefined>`

Returns the meta from the highest-priority layer that has the key — useful for inspecting sidecar fields like `etag`, `ttl`, etc.

### `Cacheables.key(...args): string`

Joins the parts with `:`. Identical to v3.

```ts
Cacheables.key('user', 42) // 'user:42'
```

## Storage adapters

### `IStorageAdapter` contract

```ts
interface IBaseMeta {
  storedAt: number
}

interface IStorageAdapter<TMeta extends IBaseMeta = IBaseMeta> {
  read<T>(key: string): Promise<{ value: T } | undefined>
  write<T>(key: string, value: T, meta?: TMeta): Promise<void>
  meta(key: string): Promise<TMeta | undefined>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
```

Rules:

- `meta` MUST be cheap. The engine probes it on every layer for every read.
- `read` returns `undefined` when the entry is absent and `{ value }` when it's present — the wrapper exists so adapters can store entries whose value is itself `undefined` without colliding with the absence signal.
- When `write` receives a `meta`, the adapter MUST persist `meta.storedAt` verbatim (other fields MAY be transformed). This guarantees `max-age` semantics stay coherent across layers.
- When `write` is called with no `meta`, the adapter MUST synthesize one with `storedAt: Date.now()`.
- `clear` MUST remove every entry the adapter manages.
- Any throw from any adapter rejects the surrounding `remember()` call. There is no per-adapter error suppression.

### Built-in `MemoryAdapter`

Ships with the package; covers the common in-memory use case.

```ts
import { Cacheables, MemoryAdapter } from 'cacheables'

const cache = new Cacheables({ adapters: [new MemoryAdapter()] })
```

### Writing your own adapter

Implement `IStorageAdapter`. The contract is small enough that filesystem, Redis, IndexedDB, or S3 layers are easy to add without ceremony. A typical L2 keeps a sidecar (file, table, key/value entry) so `meta()` is cheap.

```ts
import type { IStorageAdapter, IBaseMeta } from 'cacheables'

class FileSystemAdapter implements IStorageAdapter {
  async read<T>(key: string): Promise<{ value: T } | undefined> { /* … */ }
  async write<T>(key: string, value: T, meta?: IBaseMeta): Promise<void> { /* … */ }
  async meta(key: string): Promise<IBaseMeta | undefined> { /* … */ }
  async delete(key: string): Promise<void> { /* … */ }
  async clear(): Promise<void> { /* … */ }
}
```

### Cascade behavior

```ts
const cache = new Cacheables({
  adapters: [new MemoryAdapter(), new FileSystemAdapter()],
  policy: 'max-age',
  maxAge: 60_000,
})
```

- **Read**: probe `meta()` on every layer in parallel; the first layer that satisfies the freshness predicate is the hit. Read its value, and back-fill every other layer that is still missing the key — using the hit layer's meta so `storedAt` is preserved everywhere.
- **Miss + resource()**: write to L1 with no meta (L1 synthesizes its own), read meta back from L1, then write to L2..Ln with that exact meta. All layers converge to the same `storedAt`.
- **Stale L1 + fresh L2 (under `max-age`)**: the freshness predicate filters per-layer, so the engine returns the fresh L2 value and back-fills L1.

### Typed metadata (`TMeta`)

`Cacheables` is generic in `TMeta`. Extend it to carry sidecar fields:

```ts
import { Cacheables, type IBaseMeta, type IStorageAdapter } from 'cacheables'

interface ETagMeta extends IBaseMeta {
  etag: string
}

class ETagAdapter implements IStorageAdapter<ETagMeta> {
  // read / write / meta / delete / clear …
}

const cache = new Cacheables<ETagMeta>({
  adapters: [new ETagAdapter()],
})

const meta = await cache.meta('user:42') // typed as ETagMeta | undefined
```

Every adapter passed to the constructor must satisfy `IStorageAdapter<ETagMeta>`, and the TypeScript compiler enforces it. The built-in `MemoryAdapter` only implements `IStorageAdapter<IBaseMeta>`, so it can't be used in a `Cacheables` instance with a custom `TMeta` — write a custom adapter (or wrap `MemoryAdapter`) when you need extended metadata.

## Namespacing

Set `namespace` and every adapter call sees keys prefixed with `${namespace}:`:

```ts
const adapter = new MemoryAdapter()
const tenantA = new Cacheables({ adapters: [adapter], namespace: 'tenant-a' })
const tenantB = new Cacheables({ adapters: [adapter], namespace: 'tenant-b' })
```

Two instances can share an adapter without colliding. `delete` and `isCached` respect the namespace; `clear()` wipes the entire underlying adapter (it has no notion of which keys belong to which namespace), so reach for it only when you really mean *everything*.

## Cache Policies

| Policy                          | Behaviour                                                                                                                                                                                                                                                                                              |
|---------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `cache-only` *(default)*        | Return any cached value; on miss, call `resource()`. Concurrent miss callers share one fetch.                                                                                                                                                                                                          |
| `network-only`                  | Always call `resource()`; concurrent calls each get their own.                                                                                                                                                                                                                                         |
| `network-only-non-concurrent`   | Always call `resource()`, but concurrent calls share one in-flight request.                                                                                                                                                                                                                            |
| `max-age` *(maxAge required)*   | Return cache if `Date.now() - storedAt <= maxAge`, otherwise fetch.                                                                                                                                                                                                                                    |
| `stale-while-revalidate`        | Return the cached value immediately; if `maxAge` is unset or exceeded, fire a background revalidation.                                                                                                                                                                                                 |

```ts
new Cacheables({ adapters: [new MemoryAdapter()], policy: 'max-age', maxAge: 1_000 })
```

## Migrating from v3 → v4

Breaking changes:

- `adapters` is now a **required** constructor option. `new Cacheables()` no longer compiles. Pass at least one adapter, e.g. `new Cacheables({ adapters: [new MemoryAdapter()] })`.
- `delete(key)` returns `Promise<void>` (was `void`). Add `await`.
- `clear()` returns `Promise<void>` (was `void`). Add `await`.
- `isCached(key)` returns `Promise<boolean>` (was `boolean`). Add `await`.
- `keys()` is **removed**. Enumerating heterogeneous async layers (some non-enumerable, like CDNs) doesn't have a single sensible semantic.
- `Cacheables` is now generic in `TMeta`. Plain `new Cacheables({ adapters })` defaults to `Cacheables<IBaseMeta>` and is source-compatible at the type level.
- New constructor options: `adapters` (required) and `namespace` (optional).
- Any throw from any adapter rejects `remember()`. Previously the in-memory store couldn't fail; this is new strict-error surface for users with custom adapters.

## License

The MIT License (MIT). Please see [License File](LICENSE.md) for more information.
