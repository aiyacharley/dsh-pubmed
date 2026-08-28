// pubtator-test.mjs — verify pubmed_pubtator_annotate (biocjson) parsing + tool.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const tools = {}
const JSON_BODY = {
  PubTator3: [
    {
      _id: '123|None', id: '123', infons: {},
      passages: [
        {
          infons: { type: 'title', journal: 'Br J Surg. 1975' },
          offset: 0,
          text: 'duodenogastric reflux and gastritis study.',
          annotations: [
            { id: '2', infons: { identifier: 'D004383', type: 'Disease', database: 'MeSH', normalized_id: 'D004383' }, text: 'duodenogastric reflux', locations: [{ offset: 0, length: 21 }] },
            { id: '3', infons: { identifier: 'D005756', type: 'Disease', database: 'MeSH' }, text: 'gastritis', locations: [{ offset: 26, length: 9 }] },
          ],
          relations: [],
        },
      ],
    },
    {
      id: '39747692', _id: '39747692|None', infons: {},
      passages: [
        {
          infons: { type: 'title' },
          offset: 0,
          text: 'IgA coating of microbes.',
          annotations: [
            { id: '5', infons: { identifier: '973', type: 'Gene', database: 'ncbi_gene', normalized_id: 973, name: 'CD79A' }, text: 'IgA', locations: [{ offset: 0, length: 3 }] },
            { id: '6', infons: { identifier: '9606', type: 'Species', database: 'ncbi_taxonomy' }, text: 'human', locations: [{ offset: 14, length: 5 }] },
          ],
          relations: [],
        },
      ],
    },
  ],
}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools[d.name] = d },
  httpGet: async () => ({ status: 200, body: JSON.stringify(JSON_BODY) }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(5000) })

const res = await tools.pubmed_pubtator_annotate.execute({ pmids: ['123', '39747692'], full: false }, S('pt'))
console.log('articles:', res.articles.length, 'entities:', res.entityCount)
for (const k of Object.keys(res.byType)) {
  console.log('  ' + k + ':', res.byType[k].length)
  for (const e of res.byType[k]) console.log('    ' + e.pmid + ' | ' + (e.database ? e.database + ':' : '') + e.id + ' | ' + e.surface)
}
// lossless-JSON sanity: deep-walk for undefined/NaN
function walk(v) {
  if (Array.isArray(v)) return v.every(walk)
  if (v !== null && typeof v === 'object') return Object.keys(v).every((k) => v[k] !== undefined && walk(v[k]))
  if (typeof v === 'number') return Number.isFinite(v)
  return true
}
const checks = [
  ['2 articles', res.articles.length === 2],
  ['4 entities', res.entityCount === 4],
  ['Disease x2', (res.byType.Disease || []).length === 2],
  ['Gene x1 id=973', (res.byType.Gene || [])[0] && (res.byType.Gene[0].id === '973')],
  ['Species x1 id=9606', (res.byType.Species || [])[0] && (res.byType.Species[0].id === '9606')],
  ['database ncbi_gene', (res.byType.Gene || [])[0].database === 'ncbi_gene'],
  ['name CD79A', (res.byType.Gene || [])[0].name === 'CD79A'],
  ['lossless (no undefined/NaN)', walk(res)],
]
for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks.some(([, ok]) => !ok)) { console.log('PUBTATOR FAIL'); process.exit(1) }
console.log('PUBTATOR TEST OK')
