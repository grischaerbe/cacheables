import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const fixupPackages = () => {
  writeFileSync(
    join(__dirname, 'dist', 'mjs', 'package.json'),
    JSON.stringify({ type: 'module' }, null, 2),
  )

  writeFileSync(
    join(__dirname, 'dist', 'cjs', 'package.json'),
    JSON.stringify({ type: 'commonjs' }, null, 2),
  )
}

fixupPackages()
