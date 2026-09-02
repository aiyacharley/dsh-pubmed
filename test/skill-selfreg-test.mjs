// skill-selfreg-test.mjs — P3.9: plugin activation self-registers the skill doc
// into $DSH_HOME/skills/dsh-pubmed/SKILL.md (idempotent, content-synced,
// SKILL_DOC toggle). Uses a temp DSH_HOME — never touches the real one.
import { mkdtempSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tempHome = mkdtempSync(join(tmpdir(), 'dsh-skill-selfreg-'))
process.env.DSH_HOME = tempHome

const mod = await import('../lib/index.js')
const registered = []
const ctx = { get: (k) => (k === 'tools' ? { register: (d) => registered.push(d.name) } : undefined) }

const skillPath = join(tempHome, 'skills', 'dsh-pubmed', 'SKILL.md')
const pkgSkill = readFileSync(new URL('../skills/dsh-pubmed/SKILL.md', import.meta.url), 'utf8')

const checks = []
const add = (name, ok) => checks.push([name, ok])

// 1) first activation: doc generated, tools registered
mod.apply(ctx, {})
const m1 = statSync(skillPath)
add('1 skill doc generated at $DSH_HOME/skills/dsh-pubmed/', existsSync(skillPath))
add('1 content synced from package SKILL.md', readFileSync(skillPath, 'utf8') === pkgSkill)
// v0.4.0: 19 base tools + pubmed_search_papers (E3) + 5 Semantic Scholar tools (E5) = 25
add('1 25 tools registered on activation', registered.length === 25)

// 2) second activation: idempotent (no rewrite when content unchanged)
const mBefore = statSync(skillPath).mtimeMs
await new Promise((r) => setTimeout(r, 60))
mod.apply(ctx, {})
add('2 idempotent — unchanged doc not rewritten', statSync(skillPath).mtimeMs === mBefore)

// 3) version-aware: doc content changes on next release → rewrite
writeFileSync(skillPath, '# stale doc\n', 'utf8')
mod.apply(ctx, {})
add('3 updated doc rewritten on activation', readFileSync(skillPath, 'utf8') === pkgSkill)

// 4) SKILL_DOC:false disables self-registration (stale doc stays stale)
writeFileSync(skillPath, '# stale doc\n', 'utf8')
mod.apply(ctx, { SKILL_DOC: false })
add('4 SKILL_DOC:false disables registration', readFileSync(skillPath, 'utf8') === '# stale doc\n')

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks.some(([, ok]) => !ok)) { console.log('SKILL SELFREG FAIL'); process.exit(1) }
console.log('SKILL SELFREG TEST OK')
