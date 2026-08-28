// d-fallback-test.mjs — verify the DEFAULT PubTator integration:
// 1) enrichment: httpGet returns biocjson → graph gets concept nodes + relations
// 2) fallback:   httpGet throws → graph still builds from heuristic (no crash)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()

function makeTools(httpGetImpl) {
  const tools = {}
  registerPubmedTools({ get: () => undefined }, {
    defineTool: (o) => o,
    register: (d) => { tools[d.name] = d },
    httpGet: httpGetImpl,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
  return tools
}
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(5000) })

// ---- 1) enrichment path ----
const BIOCJSON = JSON.stringify({ PubTator3: [{ id: '11111111', passages: [{ infons: { type: 'title' }, text: 'IgA study', annotations: [
  { id: '1', infons: { identifier: '973', type: 'Gene', database: 'ncbi_gene', name: 'CD79A', accession: '@GENE_CD79A' }, text: 'IgA', locations: [{ offset: 0, length: 3 }] },
  { id: '2', infons: { identifier: '31053', type: 'Gene', database: 'ncbi_gene', name: 'CD79B', accession: '@GENE_CD79B' }, text: 'CD79B', locations: [{ offset: 10, length: 5 }] },
] }] }] })
const RELS = JSON.stringify([
  { type: 'interact', source: '@GENE_CD79A', target: '@GENE_CD79B', publications: 47 },
])
const httpGetImpl = async (url) => {
  if (String(url).includes('biocjson')) return { status: 200, body: BIOCJSON }
  if (String(url).includes('/relations')) return { status: 200, body: RELS }
  throw new Error('unexpected url')
}
const t1 = makeTools(httpGetImpl)
await t1.pubmed_graph_reset.execute({ scope: 'session' }, S('d'))
await t1.pubmed_graph_add.execute({ articles: [{ pmid: '11111111', title: 'IgA study', abstractText: 'IgA study.', meshTerms: [] }] }, S('d'))
const g1 = await t1.pubmed_graph_get.execute({ scope: 'session' }, S('d'))
const cons = g1.session.nodes.filter((n) => n.type === 'concept')
const relEdges = g1.session.edges.filter((e) => e.kind === 'relation')
console.log('enrichment: concepts=' + cons.length + ' relationEdges=' + relEdges.length)
for (const c of cons) console.log('  ' + c.id + ' | ' + c.label)
for (const e of relEdges) console.log('  ' + e.source + ' --[' + e.label + '(' + e.weight + ')]--> ' + e.target)
const checks1 = [
  ['concepts from default extractPubtator', cons.length === 2],
  ['concept Gene:973', cons.some((c) => c.conceptId === '973')],
  ['concept Gene:31053', cons.some((c) => c.conceptId === '31053')],
  ['curated relation interact(47)', relEdges.some((e) => e.label === 'interact' && e.weight === 47)],
]
for (const [name, ok] of checks1) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks1.some(([, ok]) => !ok)) { console.log('D ENRICH FAIL'); process.exit(1) }

// ---- 2) fallback path: PubTator fetch throws → heuristic still builds ----
const t2 = makeTools(async () => { throw new Error('network down') })
await t2.pubmed_graph_reset.execute({ scope: 'session' }, S('d2'))
const add2 = await t2.pubmed_graph_add.execute({ articles: [{ pmid: '22222222', title: 'Microbiota regulates metabolism', abstractText: 'Gut microbiota regulates bile acid metabolism.', meshTerms: [{ descriptorName: 'Microbiota' }] }] }, S('d2'))
const g2 = await t2.pubmed_graph_get.execute({ scope: 'session' }, S('d2'))
const kwCount = g2.session.nodes.filter((n) => n.type === 'keyword').length
const conceptCount = g2.session.nodes.filter((n) => n.type === 'concept').length
console.log('fallback: keywords=' + kwCount + ' concepts=' + conceptCount + ' edges=' + g2.session.stats.edgeCount)
const checks2 = [
  ['fallback builds keywords (heuristic still runs)', kwCount > 0],
  ['fallback has 0 concepts (PubTator down)', conceptCount === 0],
  ['fallback graph has edges', g2.session.stats.edgeCount > 0],
]
for (const [name, ok] of checks2) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks2.some(([, ok]) => !ok)) { console.log('D FALLBACK FAIL'); process.exit(1) }
console.log('D TEST OK — enrichment + fallback verified')
