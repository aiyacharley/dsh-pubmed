// c1-concept-test.mjs — verify PubTator concept nodes merge into the graph
// (dedup by concept ID, article→concept edges, summary, mermaid class).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const tools = {}
// Mock PubTator: two articles share concept Gene:973 (IgA) → must dedup to ONE node.
const extractPubtator = (a) => {
  if (a.pmid === '11111111') return [
    { type: 'Gene', id: '973', database: 'ncbi_gene', surface: 'IgA' },
    { type: 'Species', id: '9606', database: 'ncbi_taxonomy', surface: 'human' },
    { type: 'Disease', id: 'D011695', database: 'ncbi_mesh', surface: 'IgA Vasculitis' },
  ]
  if (a.pmid === '22222222') return [
    { type: 'Gene', id: '973', database: 'ncbi_gene', surface: 'IgA' },
    { type: 'Gene', id: '31053', database: 'ncbi_gene', surface: 'CD79B' },
  ]
  return []
}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools[d.name] = d },
  httpGet: async () => { throw new Error('network not used') },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  extractPubtator,
})
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(5000) })

const articles = [
  { pmid: '11111111', title: 'IgA study A', abstractText: 'IgA shapes the microbiota.', meshTerms: [{ descriptorName: 'Immunoglobulin A' }] },
  { pmid: '22222222', title: 'IgA study B', abstractText: 'CD79B interacts with IgA.', meshTerms: [{ descriptorName: 'B-Lymphocytes' }] },
]
await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('c'))
const add1 = await tools.pubmed_graph_add.execute({ articles }, S('c'))
console.log('add stats:', JSON.stringify(add1.stats))
const g = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('c'))
const cons = g.session.nodes.filter((n) => n.type === 'concept')
console.log('concept nodes:', cons.length)
for (const c of cons) console.log('  ' + c.id + ' | label=' + c.label + ' | subtype=' + c.subtype + ' | count=' + c.count + ' | sources=' + c.sources.join(','))
const acEdges = g.session.edges.filter((e) => e.kind === 'article-concept')
console.log('article-concept edges:', acEdges.length)

const checks = [
  ['stats.concepts=4', g.session.stats.concepts === 4],
  ['Gene:973 dedup to 1 node', cons.filter((c) => c.conceptId === '973').length === 1],
  ['Gene:973 count=2 (both articles)', cons.find((c) => c.conceptId === '973').count === 2],
  ['Gene:973 sources=[11111111,22222222]', cons.find((c) => c.conceptId === '973').sources.length === 2],
  ['Species:9606 present', cons.some((c) => c.conceptId === '9606' && c.subtype === 'Species')],
  ['Disease D011695 present', cons.some((c) => c.conceptId === 'D011695' && c.subtype === 'Disease')],
  ['Gene:31053 present', cons.some((c) => c.conceptId === '31053')],
  ['article-concept edges=5 (2+3+1+1)', acEdges.length === 5],
]
for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks.some(([, ok]) => !ok)) { console.log('C1 FAIL'); process.exit(1) }

// mermaid includes concept nodes + class
const m = await tools.pubmed_graph_get.execute({ scope: 'session', format: 'mermaid', maxKeywords: 5 }, S('c'))
const code = m.mermaid.session
console.log('mermaid has concept classDef:', code.includes('classDef concept fill:#3C5488FF'))
console.log('mermaid has concept node id:', code.includes('IgA [973]') || code.includes('IgA'))
if (!code.includes('classDef concept')) { console.log('C1 MERMAID FAIL'); process.exit(1) }
console.log('C1 TEST OK')
