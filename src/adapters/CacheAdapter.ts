export abstract class CacheAdapter {
  abstract has(key: string): Promise<boolean> | boolean
  abstract get(key: string): Promise<any> | any
  abstract put(key: string, value: unknown): Promise<void> | void
}
