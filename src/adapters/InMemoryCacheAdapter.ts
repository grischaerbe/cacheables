import { CacheAdapter } from './CacheAdapter'

export class InMemoryCacheAdapter extends CacheAdapter {
  cache: Record<string, any> = {}

  has(key: string): boolean {
    return !!this.cache[key]
  }

  get(key: string): any {
    return this.cache[key]
  }

  put(key: string, value: unknown): void {
    this.cache[key] = value
  }
}
