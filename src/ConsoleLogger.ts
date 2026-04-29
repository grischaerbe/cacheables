import type { ILogger } from './types'

export const consoleLogger: ILogger = {
  // eslint-disable-next-line no-console
  log: (message) => console.log(message),
}
