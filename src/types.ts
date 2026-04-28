/**
 * Base shape for all bucket metadata. Buckets MAY extend this with
 * additional sidecar fields (etag, ttl, version, etc.) provided their
 * extension is captured by the `TMeta` generic of `Cacheable`.
 */
export interface IBaseMeta {
  storedAt: number
}

/**
 * Bucket contract. Buckets back the layers (L1, L2, ...) of a
 * `Cacheable` instance. Reads cascade L1 → Ln; on any hit the engine
 * fills missing layers with the hit value preserving `meta.storedAt`.
 *
 * Under a `Cacheable`, the engine always supplies `meta` to `write`
 * (both on cascade write and on backfill), so buckets receive a
 * consistent `storedAt` across every layer. The no-meta synthesis
 * branch only matters when a bucket is used standalone.
 *
 * Contracts:
 * - `meta` MUST be cheap (engine probes it on every layer per read).
 * - `read` returns `undefined` when the entry is absent and `{ value }`
 *   when present — the wrapper exists so buckets can store entries
 *   whose value is itself `undefined` without colliding with the
 *   absence signal.
 * - When `write` receives a `meta`, the bucket MUST persist
 *   `meta.storedAt` verbatim. Other fields MAY be transformed.
 * - When `write` receives no `meta`, the bucket MUST synthesize one
 *   with `storedAt: Date.now()` (and any other `TMeta` fields it knows
 *   how to populate).
 * - `clear` MUST remove every entry the bucket manages.
 * - All five methods MAY throw on infrastructure errors. The engine
 *   treats throws as fatal (strict mode).
 */
export interface IBucket<TMeta extends IBaseMeta = IBaseMeta> {
  read<T>(key: string): Promise<{ value: T } | undefined>
  write<T>(key: string, value: T, meta?: TMeta): Promise<void>
  meta(key: string): Promise<TMeta | undefined>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

/**
 * Logger contract. Implement to route cache messages into your own
 * logging stack. When a `Cacheable` is constructed with a `logger`,
 * the engine emits a timing message and a hit-count message on every
 * `remember()` invocation. When no logger is provided, the engine is
 * silent.
 */
export interface ILogger {
  log(message: string): void
}

type CacheOptionsBase = {
  /**
   * Optional logger. When provided, the engine emits cache messages
   * via `logger.log(...)`. Omit to keep the engine silent.
   */
  logger?: ILogger
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
 * Combined cache options without bucket wiring. Kept exported for
 * backwards-compatible consumer types that mirror the policy shape.
 */
export type CacheOptions = CacheOptionsBase & PolicyOptions

/**
 * Constructor options for `Cacheable<TMeta>`. The namespace is passed
 * as a positional argument; this bag carries everything else.
 *
 * `buckets` is required; the array is L1 first.
 */
export type CacheableOptions<TMeta extends IBaseMeta = IBaseMeta> =
  CacheOptionsBase &
    PolicyOptions & {
      buckets: IBucket<TMeta>[]
    }
