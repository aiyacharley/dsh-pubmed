// autograph-test.mjs — verify AUTO_GRAPH mode: pubmed_fetch_articles
// automatically merges results into the current session graph (no network).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const tools = {}
const MED = [
  'PMID- 12345',
  'TI  - Gut microbiota regulates bile acid metabolism.',
  'AB  - The gut microbiome regulates metabolism and interacts with host pathways.',
  'FAU - Smith, John',
  'JT  - Test Journal',
  'DP  - 2023',
  'TA  - Test J',
  'LID - 10.1/x [doi]',
  'MH  - Microbiota',
  '',
  'PMID- 67890',
  'TI  - Short chain fatty acids promote host immunity.',
  'AB  - Butyrate modulates inflammation.',
  'FAU - Doe, Jane',
  'JT  - Test Journal 2',
  'DP  - 2023',
  'TA  - Test J2',
  'LID - 10.2/y [doi]',
  'MH  - Fatty Acids, Volatile',
  '',
].join('\n')
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools[d.name] = d },
  httpGet: async () => ({ status: 200, body: MED }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  autoGraph: true,
})
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(5000) })

await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('ag'))
const res = await tools.pubmed_fetch_articles.execute({ pmids: ['12345', '67890'] }, S('ag'))
console.log('fetch articles: ' + (res.articles || []).length + '  autoGraph: ' + JSON.stringify(res.autoGraph))
if (!res.autoGraph || res.autoGraph.addedNodes < 5) { console.log('AUTOGRAPH FLAG FAIL'); process.exit(1) }
const g = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('ag'))
console.log('session graph after auto-fetch: ' + g.session.stats.nodeCount + ' nodes / ' + g.session.stats.edgeCount + ' edges')
if (g.session.stats.nodeCount < 5) { console.log('AUTOGRAPH MERGE FAIL'); process.exit(1) }
console.log('AUTOGRAPH TEST OK')
