import type { ILogger } from './types.js'

export const consoleLogger: ILogger = {
  // eslint-disable-next-line no-console
  log: (message) => console.log(message),
}
