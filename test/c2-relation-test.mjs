// c2-relation-test.mjs — verify curated concept→concept relation edges merge
// into the graph and render as red mermaid arrows between concept nodes.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const tools = {}
const extractPubtator = (a) => {
  if (a.pmid === '11111111') return [
    { type: 'Gene', id: '973', database: 'ncbi_gene', surface: 'IgA' },
    { type: 'Gene', id: '31053', database: 'ncbi_gene', surface: 'CD79B' },
  ]
  return []
}
// curated relations between this article's concepts (nodeId form)
const extractPubtatorRelations = (concepts) => {
  const ids = concepts.map((c) => c.nodeId)
  const out = []
  if (ids.includes('concept:Gene:973') && ids.includes('concept:Gene:31053')) {
    out.push({ source: 'concept:Gene:973', target: 'concept:Gene:31053', type: 'interact', publications: 47 })
  }
  return out
}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools[d.name] = d },
  httpGet: async () => { throw new Error('network not used') },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  extractPubtator,
  extractPubtatorRelations,
})
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(5000) })

await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('c2'))
await tools.pubmed_graph_add.execute({ articles: [{ pmid: '11111111', title: 'IgA study', abstractText: 'IgA and CD79B interact.', meshTerms: [] }] }, S('c2'))
const g = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('c2'))
const relEdges = g.session.edges.filter((e) => e.kind === 'relation')
console.log('relation edges:', relEdges.length)
for (const e of relEdges) console.log('  ' + e.source + ' --[' + e.label + '(' + e.weight + ')]--> ' + e.target)

const checks = [
  ['has concept→concept relation edge', relEdges.some((e) => e.source.startsWith('concept:') && e.target.startsWith('concept:'))],
  ['relation type=interact', relEdges.some((e) => e.label === 'interact')],
  ['weight=publications 47', relEdges.some((e) => e.weight === 47)],
]
for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks.some(([, ok]) => !ok)) { console.log('C2 FAIL'); process.exit(1) }

// mermaid: concept nodes + red relation arrow between them
const m = await tools.pubmed_graph_get.execute({ scope: 'session', format: 'mermaid' }, S('c2'))
const code = m.mermaid.session
const hasConceptClass = code.includes('classDef concept fill:#3C5488FF')
const hasRedRel = code.includes('stroke:#DC0000FF')
const hasInteractArrow = code.includes('-->|interact|')
console.log('mermaid: concept class=' + hasConceptClass + ' red link=' + hasRedRel + ' interact arrow=' + hasInteractArrow)
if (!hasConceptClass || !hasRedRel || !hasInteractArrow) { console.log('C2 MERMAID FAIL'); process.exit(1) }
console.log('C2 TEST OK')
