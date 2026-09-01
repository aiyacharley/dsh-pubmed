// stress-graph.mjs — offline stress test for the graph engine: 50 rounds × 10
// synthetic articles, incremental merge; checks timing, node/edge growth,
// monotonic stability, and commit/merge behavior. No network.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const tools = {}
let userGraph = null
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools[d.name] = d },
  httpGet: async () => { throw new Error('offline') },
  sleep: () => Promise.resolve(),
  storage: {
    loadUserGraph: () => (userGraph ? JSON.parse(JSON.stringify(userGraph)) : null),
    saveUserGraph: (g) => { userGraph = JSON.parse(JSON.stringify(g)); return true },
    clearUserGraph: () => { userGraph = null; return true },
  },
})
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(120000) })

const gen = (round, i) => ({
  pmid: String(90000000 + round * 100 + i),
  title: `Stress round ${round} article ${i}: biomarker-${i} regulates pathway-${round % 7} in disease-${round % 5}`,
  abstractText: `Article ${i} of round ${round}. biomarker-${i} modulates pathway-${round % 7} signaling and influences disease-${round % 5} progression via mediator-${i}. Repeated terms: pathway-${round % 7} pathway-${round % 7} disease-${round % 5}.`,
  meshTerms: [{ descriptorName: `Stress Topic ${round % 7}` }],
})

const t0 = Date.now()
let lastNodes = 0
let monotonic = true
for (let round = 0; round < 50; round++) {
  const articles = Array.from({ length: 10 }, (_, i) => gen(round, i))
  const r = await tools.pubmed_graph_add.execute({ articles }, S('stress'))
  const stats = r.stats
  if (round % 10 === 9) console.log(`round ${round + 1}/50 → nodes=${stats.nodeCount} edges=${stats.edgeCount} (round took ${Date.now() - t0}ms cumulative)`)
  if (stats.nodeCount < lastNodes) monotonic = false
  lastNodes = stats.nodeCount
}
const t1 = Date.now()

// stability: same round twice → second adds 0 (idempotent by pmid+title id)
const dup = await tools.pubmed_graph_add.execute({ articles: [gen(49, 0), gen(49, 1)] }, S('stress'))
console.log(`duplicate re-add → addedNodes=${dup.addedNodes} addedEdges=${dup.addedEdges} (expect 0/0)`)

// commit + reload
const c = await tools.pubmed_graph_commit.execute({ confirm: true }, S('stress'))
const gU = await tools.pubmed_graph_get.execute({ scope: 'user' }, S('other-session'))
console.log(`commit → user nodes=${c.stats.nodeCount} edges=${c.stats.edgeCount}; reloaded from storage: ${gU.user.stats.nodeCount} nodes`)

// mermaid on the big graph
const t2 = Date.now()
const m = await tools.pubmed_graph_get.execute({ scope: 'user', format: 'mermaid', maxKeywords: 20, minCount: 2 }, S('stress'))
console.log(`mermaid on big graph: ${(m.mermaid.user || '').length} chars in ${Date.now() - t2}ms`)

const g = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('stress'))
console.log(`\nRESULT: 500 articles merged in ${t1 - t0}ms; session=${g.session.stats.nodeCount} nodes / ${g.session.stats.edgeCount} edges; monotonicGrowth=${monotonic}; dupAdded=${dup.addedNodes}`)
if (!monotonic || dup.addedNodes !== 0 || gU.user.stats.nodeCount === 0) { console.log('STRESS FAIL'); process.exit(1) }
console.log('STRESS OK')
