/**
 * Engine-internal probe shape. The engine mints a `BucketEntryMeta`
 * for every cascade write and reads it back via `bucket.meta(key)` to
 * decide hits and apply freshness predicates. Bucket implementers
 * type their `meta()` method against this shape; consumers of
 * `Cacheable` never see it.
 */
export interface BucketEntryMeta {
  storedAt: number
}

/**
 * Bucket contract. Buckets back the layers (L1, L2, ...) of a
 * `Cacheable` instance. Reads cascade L1 → Ln; on any hit the engine
 * fills missing or stale layers with the hit value preserving
 * `meta.storedAt`.
 *
 * `TView` is the bucket's user-facing projection — what
 * `cache.resolve()` returns. A bucket without a meaningful projection
 * (e.g. `MemoryBucket`) sets `TView = void` and returns
 * `{ view: undefined }` from `resolve` when the entry is present.
 *
 * The engine maintains two parallel cascade paths: `cache.remember()`
 * uses `read` (value-cascade), `cache.resolve()` uses `resolve`
 * (view-cascade). The view-cascade hot path skips the value read
 * entirely on L1 hits when no other layer needs back-filling.
 *
 * Contracts:
 * - `meta` MUST be cheap (engine probes it on every layer per read).
 * - `read` returns `undefined` when the entry is absent and `{ value }`
 *   when present — the wrapper exists so buckets can store entries
 *   whose value is itself `undefined` without colliding with the
 *   absence signal.
 * - `write` MUST persist `meta.storedAt` verbatim.
 * - `resolve` returns `undefined` when the entry is absent and
 *   `{ view }` when present. The wrapper mirrors `read`: it lets
 *   `TView = void` buckets distinguish "entry present, no projection"
 *   (`{ view: undefined }`) from "entry absent" (`undefined`). The
 *   engine treats absence after a meta-probe hit as a race and heals
 *   it like the read path; absence after a successful cascade
 *   write/fill is a strict-mode error and the engine throws.
 * - `clear` MUST remove every entry the bucket manages.
 * - All six methods MAY throw on infrastructure errors. The engine
 *   treats throws as fatal (strict mode).
 */
export interface IBucket<TView = void> {
  read<T>(key: string): Promise<{ value: T } | undefined>
  write<T>(key: string, value: T, meta: BucketEntryMeta): Promise<void>
  meta(key: string): Promise<BucketEntryMeta | undefined>
  resolve(key: string): Promise<{ view: TView } | undefined>
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
 * Constructor options for `Cacheable<TView>`. The namespace is passed
 * as a positional argument; this bag carries everything else.
 *
 * `buckets` is required; the array is L1 first.
 */
export type CacheableOptions<TView = void> = CacheOptionsBase &
  PolicyOptions & {
    buckets: IBucket<TView>[]
  }
