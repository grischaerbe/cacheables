import type { ILogger } from './types'

export class ConsoleLogger implements ILogger {
  log(message: string): void {
    // eslint-disable-next-line no-console
    console.log(message)
  }
}
