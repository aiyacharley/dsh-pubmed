// mermaid-test.mjs — verify pubmed_graph_get({format:'mermaid'}) emits a colored
// flowchart (NPG palette) from the graph data.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const tools = {}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools[d.name] = d },
  httpGet: async () => { throw new Error('network not used') },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(5000) })

const articles = [
  { pmid: '11111111', title: 'Gut microbiota regulates bile acid metabolism', abstractText: 'Gut microbiota regulates bile acid metabolism. Bacteria produce metabolites.', meshTerms: [{ descriptorName: 'Gastrointestinal Microbiome' }, { descriptorName: 'Bile Acids and Salts' }] },
  { pmid: '22222222', title: 'Cross feeding promotes host immunity', abstractText: 'Bacteria share metabolites. Microbiota modulates inflammation.', meshTerms: [{ descriptorName: 'Microbiota' }] },
]
await tools.pubmed_graph_add.execute({ articles }, S('m'))
const res = await tools.pubmed_graph_get.execute({ scope: 'session', format: 'mermaid', maxKeywords: 10 }, S('m'))
const code = res.mermaid.session
console.log('--- mermaid code (head) ---')
console.log(code.split('\n').slice(0, 16).join('\n'))
console.log('...')
console.log('--- checks ---')
const checks = [
  ['flowchart', code.startsWith('flowchart LR')],
  ['article classDef', code.includes('classDef article fill:#E64B35FF')],
  ['keyword classDef', code.includes('classDef kw fill:#00A087FF')],
  ['relation red linkStyle', code.includes('stroke:#DC0000FF')],
  ['undirected blue linkStyle', code.includes('stroke:#8491B4FF')],
  ['relation label', code.includes('-->|')],
  ['article node', code.includes('PMID 11111111')],
]
for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks.some(([, ok]) => !ok)) { console.log('MERMAID FAIL'); process.exit(1) }
console.log('MERMAID TEST OK')
