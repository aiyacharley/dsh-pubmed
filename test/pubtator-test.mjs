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

// ---- B2: entity_id (autocomplete) ----
const AUTO = [
  { _id: '@GENE_CD79A', biotype: 'gene', db_id: '973', db: 'ncbi_gene', name: 'CD79A', match: 'Matched on synonyms <m>IGA</m>' },
  { _id: '@DISEASE_IgA_Vasculitis', biotype: 'disease', db_id: 'D011695', db: 'ncbi_mesh', name: 'IgA Vasculitis', match: 'Matched on name <m>IgA Vasculitis</m>' },
]
const tools2 = {}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools2[d.name] = d },
  httpGet: async (url) => {
    if (String(url).includes('entity/autocomplete')) return { status: 200, body: JSON.stringify(AUTO) }
    return { status: 200, body: JSON.stringify(JSON_BODY) }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
const eid = await tools2.pubmed_pubtator_entity_id.execute({ query: 'IgA', concept: 'gene', limit: 10 }, S('pt'))
console.log('B2 entity_id candidates:', eid.entityCount)
for (const e of eid.entities) console.log('    ' + e.id + ' | ' + e.db + ':' + e.dbId + ' | ' + e.biotype + ' | ' + e.name)
const checks2 = [
  ['B2 has 2 candidates', eid.entityCount === 2],
  ['B2 gene @GENE_CD79A', eid.entities[0].id === '@GENE_CD79A' && eid.entities[0].dbId === '973'],
  ['B2 match html stripped', !eid.entities[0].match.includes('<m>')],
  ['B2 lossless', walk(eid)],
]
for (const [name, ok] of checks2) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks2.some(([, ok]) => !ok)) { console.log('ENTITY_ID FAIL'); process.exit(1) }

// ---- B3: relations ----
const RELS = [
  { type: 'interact', source: '@GENE_FCAR', target: '@GENE_CD79A', publications: 66 },
  { type: 'interact', source: '@GENE_CD79A', target: '@GENE_CD79B', publications: 47 },
  { type: 'treat', source: '@CHEMICAL_Steroids', target: '@DISEASE_IgA_Vasculitis', publications: 193 },
]
const tools3 = {}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools3[d.name] = d },
  httpGet: async (url) => {
    if (String(url).includes('entity/autocomplete')) return { status: 200, body: JSON.stringify(AUTO) }
    if (String(url).includes('/relations')) return { status: 200, body: JSON.stringify(RELS) }
    return { status: 200, body: JSON.stringify(JSON_BODY) }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
const rel = await tools3.pubmed_pubtator_relations.execute({ e1: '@GENE_CD79A', type: 'interact', e2: 'gene', limit: 25 }, S('pt'))
console.log('B3 relations:', rel.relationCount)
for (const r of rel.relations) console.log('    ' + r.source + ' --[' + r.type + '(' + r.publications + ')]--> ' + r.target)
const checks3 = [
  ['B3 has 3 relations', rel.relationCount === 3],
  ['B3 type interact', rel.relations[0].type === 'interact'],
  ['B3 publications 66', rel.relations[0].publications === 66],
  ['B3 lossless', walk(rel)],
]
for (const [name, ok] of checks3) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks3.some(([, ok]) => !ok)) { console.log('RELATIONS FAIL'); process.exit(1) }

// ---- B4: annotate pmcids (pmc_export routing, prefix normalization, mutual exclusion) ----
// pmc_export responses key docs by PMCID — give B4 its own PMC-keyed fixture.
const PMC_BODY = {
  PubTator3: [
    {
      id: 'PMC7696669', passages: [
        { infons: { type: 'title' }, text: 'PMC-keyed annotation doc.', annotations: [
          { infons: { identifier: 'D009369', type: 'Disease', database: 'MeSH' }, text: 'tumor', locations: [{ offset: 0, length: 5 }] },
        ] },
      ],
    },
  ],
}
const tools4 = {}
const urls4 = []
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools4[d.name] = d },
  httpGet: async (url) => {
    urls4.push(String(url))
    return { status: 200, body: JSON.stringify(String(url).includes('pmc_export') ? PMC_BODY : JSON_BODY) }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
const annPmc = await tools4.pubmed_pubtator_annotate.execute({ pmcids: ['7696669', 'PMC8869656'], full: true }, S('pt'))
const pmcUrl = urls4[urls4.length - 1]
console.log('B4 pmc url:', pmcUrl)
let threwBoth = false
try { await tools4.pubmed_pubtator_annotate.execute({ pmids: ['123'], pmcids: ['PMC1'] }, S('pt')) } catch (e) { threwBoth = true }
let threwNone = false
try { await tools4.pubmed_pubtator_annotate.execute({}, S('pt')) } catch (e) { threwNone = true }
const checks4 = [
  ['B4 routes to pmc_export', pmcUrl.includes('/publications/pmc_export/biocjson?')],
  ['B4 normalizes missing PMC prefix', decodeURIComponent(pmcUrl).includes('pmcids=PMC7696669,PMC8869656')],
  ['B4 full param forwarded', pmcUrl.includes('full=true')],
  ['B4 parses PMC-keyed doc', annPmc.articles.length === 1 && annPmc.articles[0].pmid === 'PMC7696669'],
  ['B4 lossless', walk(annPmc)],
  ['B4 pmids+pmcids together throws', threwBoth],
  ['B4 neither list throws', threwNone],
]
for (const [name, ok] of checks4) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks4.some(([, ok]) => !ok)) { console.log('PMC EXPORT FAIL'); process.exit(1) }

// ---- B5: relations evidence param (P1a) ----
const RELS_B5 = [
  { type: 'treat', source: '@CHEMICAL_X', target: '@DISEASE_Y', publications: 12 },
  { type: 'treat', source: '@CHEMICAL_X', target: '@DISEASE_Z', publications: 3 },
  { type: 'cause', source: '@CHEMICAL_X', target: '@DISEASE_W', publications: 1 },
  { type: 'treat', source: '@CHEMICAL_X', target: '@DISEASE_V', publications: 8 },
]
const SEARCH_EV = { results: [{ pmid: 111, title: 'Ev1' }, { pmid: 222, title: 'Ev2' }, { pmid: 333, title: 'Ev3' }] }
const tools5 = {}
const urls5 = []
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools5[d.name] = d },
  httpGet: async (url) => {
    const u = String(url)
    urls5.push(u)
    if (u.includes('/search/')) return { status: 200, body: JSON.stringify(SEARCH_EV) }
    if (u.includes('/relations')) return { status: 200, body: JSON.stringify(RELS_B5) }
    return { status: 200, body: JSON.stringify(JSON_BODY) }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
const ev = await tools5.pubmed_pubtator_relations.execute({ e1: '@CHEMICAL_X', evidence: true, maxEvidence: 2, limit: 10 }, S('pt'))
const searchCalls = urls5.filter((u) => u.includes('/search/')).length
console.log('B5 evidence:', JSON.stringify(ev.relations.map((r) => r.evidencePmids || null)))
const checks5 = [
  ['B5 first relation carries 2 evidence PMIDs (maxEvidence)', ev.relations[0].evidencePmids && ev.relations[0].evidencePmids.join(',') === '111,222'],
  ['B5 evidence capped to 3 relations per call (budget)', searchCalls === 3],
  ['B5 4th relation has no evidence (budget exhausted)', !ev.relations[3].evidencePmids],
  ['B5 lossless', walk(ev)],
]
for (const [name, ok] of checks5) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks5.some(([, ok]) => !ok)) { console.log('EVIDENCE FAIL'); process.exit(1) }

// ---- B6: annotate >100 ids auto-batch + B7 session cache ----
const tools6 = {}
const urls6 = []
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools6[d.name] = d },
  httpGet: async (url) => { urls6.push(String(url)); return { status: 200, body: JSON.stringify(JSON_BODY) } },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
const many = Array.from({ length: 150 }, (_, i) => String(100 + i))
const annMany = await tools6.pubmed_pubtator_annotate.execute({ pmids: many }, S('pt'))
const batchUrls = urls6.length
const annCached = await tools6.pubmed_pubtator_annotate.execute({ pmids: ['123'] }, S('pt'))
console.log('B6 batchCount=' + annMany.batchCount + ' urls=' + batchUrls + ' | B7 cacheHits=' + annCached.cacheHits + ' urlsDelta=' + (urls6.length - batchUrls))
const checks6 = [
  ['B6 150 ids → 2 batches', annMany.batchCount === 2 && urls6.length === 2],
  // id-matched merge: of the 150 requested ids only '123' exists in the
  // fixture, so exactly 1 doc (2 entity mentions) is returned.
  ['B6 merged result keeps parse shape (id-matched)', annMany.articles.length === 1 && annMany.entityCount === 2 && annMany.articles[0].pmid === '123'],
  ['B7 second call of a known pmid is a pure cache hit', annCached.cacheHits === 1 && urls6.length === 2 && annCached.articles.length === 1],
  ['B7 lossless', walk(annCached)],
]
for (const [name, ok] of checks6) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks6.some(([, ok]) => !ok)) { console.log('BATCH/CACHE FAIL'); process.exit(1) }

console.log('PUBTATOR TEST OK')
