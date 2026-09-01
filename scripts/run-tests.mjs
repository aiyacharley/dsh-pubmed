#!/usr/bin/env node
// scripts/run-tests.mjs — run the offline test suite (test/*.mjs except the
// network-bound smoke test). Set RUN_SMOKE=1 to include it (needs outbound
// access to NCBI/EBI). Exits nonzero on the first failing file.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const testDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test')
const includeSmoke = process.env.RUN_SMOKE === '1'
const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.mjs'))
  .filter((f) => (includeSmoke ? true : f !== 'smoke.mjs'))
  .sort()

let failed = 0
for (const f of files) {
  const r = spawnSync(process.execPath, [join(testDir, f)], { stdio: 'inherit' })
  if (r.status !== 0) {
    console.error('FAILED: ' + f)
    failed++
  }
}
if (failed) {
  console.error(`\n${failed} test file(s) failed`)
  process.exit(1)
}
console.log(`\nall ${files.length} test file(s) passed`)
