/**
 * Base shape for all adapter metadata. Adapters MAY extend this with
 * additional sidecar fields (etag, ttl, version, etc.) provided their
 * extension is captured by the `TMeta` generic of `Cacheables`.
 */
export interface IBaseMeta {
  storedAt: number
}

/**
 * Storage adapter contract. Adapters back layers (L1, L2, ...) of a
 * `Cacheables` instance. Reads cascade L1 → Ln; on any hit the engine
 * fills missing layers with the hit value preserving `meta.storedAt`.
 *
 * Contracts:
 * - `meta` MUST be cheap (engine probes it on every layer per read).
 * - `read` returns `undefined` when the entry is absent and `{ value }`
 *   when present — the wrapper exists so adapters can store entries
 *   whose value is itself `undefined` without colliding with the
 *   absence signal.
 * - When `write` receives a `meta`, the adapter MUST persist
 *   `meta.storedAt` verbatim. Other fields MAY be transformed.
 * - When `write` receives no `meta`, the adapter MUST synthesize one
 *   with `storedAt: Date.now()` (and any other `TMeta` fields it knows
 *   how to populate).
 * - `clear` MUST remove every entry the adapter manages.
 * - All five methods MAY throw on infrastructure errors. The engine
 *   treats throws as fatal (strict mode).
 */
export interface IStorageAdapter<TMeta extends IBaseMeta = IBaseMeta> {
  read<T>(key: string): Promise<{ value: T } | undefined>
  write<T>(key: string, value: T, meta?: TMeta): Promise<void>
  meta(key: string): Promise<TMeta | undefined>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

type CacheOptionsBase = {
  /**
   * Enables caching.
   */
  enabled?: boolean
  /**
   * Enable/disable logging of cache hits.
   */
  log?: boolean
  /**
   * Enable/disable timings.
   */
  logTiming?: boolean
}

type CacheOnlyPolicy = {
  policy?: 'cache-only'
}

type NetworkOnlyPolicy = {
  policy: 'network-only'
}

type NetworkOnlyNonConcurrentPolicy = {
  policy: 'network-only-non-concurrent'
}

type MaxAgePolicy = {
  policy: 'max-age'
  maxAge: number
}

type SWRPolicy = {
  policy: 'stale-while-revalidate'
  maxAge?: number
}

export type PolicyOptions =
  | CacheOnlyPolicy
  | NetworkOnlyPolicy
  | NetworkOnlyNonConcurrentPolicy
  | MaxAgePolicy
  | SWRPolicy

/**
 * Policy identifiers (the `policy` field's possible values).
 */
export type Policy =
  | 'cache-only'
  | 'network-only'
  | 'network-only-non-concurrent'
  | 'max-age'
  | 'stale-while-revalidate'

/**
 * Combined cache options without adapter wiring. Kept exported for
 * backwards-compatible consumer types that mirror the policy shape.
 */
export type CacheOptions = CacheOptionsBase & PolicyOptions

/**
 * Constructor options for `Cacheables<TMeta>`.
 *
 * `adapters` is required; the array is L1 first. `namespace` is
 * required and is prefixed onto every key passed to adapters as
 * `${namespace}:${key}`, isolating instances that share an adapter.
 */
export type CacheablesOptions<TMeta extends IBaseMeta = IBaseMeta> =
  CacheOptionsBase &
    PolicyOptions & {
      adapters: IStorageAdapter<TMeta>[]
      namespace: string
    }
