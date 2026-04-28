import type { IBaseMeta, IStorageAdapter } from '../types'

export class MemoryAdapter implements IStorageAdapter<IBaseMeta> {
  #store = new Map<string, { value: unknown; meta: IBaseMeta }>()

  async read<T>(key: string): Promise<{ value: T } | undefined> {
    const entry = this.#store.get(key)
    return entry === undefined ? undefined : { value: entry.value as T }
  }

  async write<T>(key: string, value: T, meta?: IBaseMeta): Promise<void> {
    this.#store.set(key, {
      value,
      meta: meta ?? ({ storedAt: Date.now() } as IBaseMeta),
    })
  }

  async meta(key: string): Promise<IBaseMeta | undefined> {
    return this.#store.get(key)?.meta
  }

  async delete(key: string): Promise<void> {
    this.#store.delete(key)
  }

  async clear(): Promise<void> {
    this.#store.clear()
  }
}
