import type { BucketEntryMeta, IBucket } from '../types.js'

export class MemoryBucket implements IBucket<void> {
  #store = new Map<string, { value: unknown; meta: BucketEntryMeta }>()

  async read<T>(key: string): Promise<{ value: T } | undefined> {
    const entry = this.#store.get(key)
    return entry === undefined ? undefined : { value: entry.value as T }
  }

  async write<T>(key: string, value: T, meta: BucketEntryMeta): Promise<void> {
    this.#store.set(key, { value, meta })
  }

  async meta(key: string): Promise<BucketEntryMeta | undefined> {
    return this.#store.get(key)?.meta
  }

  async view(key: string): Promise<{ view: void } | undefined> {
    return this.#store.has(key) ? { view: undefined } : undefined
  }

  async delete(key: string): Promise<void> {
    this.#store.delete(key)
  }

  async clear(): Promise<void> {
    this.#store.clear()
  }
}
