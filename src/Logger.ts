export class Logger {
  static getLogId(key: string): string {
    return key + '---' + Math.random().toString(36).substr(2, 9)
  }

  static logTime(key: string): void {
    // eslint-disable-next-line no-console
    console.time(key)
  }

  static logTimeEnd(key: string): void {
    // eslint-disable-next-line no-console
    console.timeEnd(key)
  }

  static logStats(key: string, hits: number): void {
    // eslint-disable-next-line no-console
    console.log(`Cacheable "${key}": hits: ${hits}`)
  }
}
