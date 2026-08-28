// nlp-test.mjs — verify NLP keyword extraction (A) AND directed-relation edges (B)
// wired through the core via compromise.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nlpExtractKeywords, nlpExtractRelations } from '../lib/nlp.js'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const factory = new Function(source + '\n; return registerPubmedTools')
const registerPubmedTools = factory()
const tools = {}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (opts) => opts,
  register: (def) => { tools[def.name] = def },
  httpGet: async () => { throw new Error('network not used') },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  extractKeywords: nlpExtractKeywords,
  extractRelations: nlpExtractRelations,
})
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(5000) })

const article = {
  pmid: '38504383',
  title: 'Microbiota-derived indoles alleviate intestinal inflammation and modulate microbiome by microbial cross-feeding',
  doi: '10.1186/s40168-024-01750-y',
  meshTerms: [{ descriptorName: 'Tryptophan' }, { descriptorName: 'Dysbiosis' }, { descriptorName: 'Microbiota' }, { descriptorName: 'Indoles' }, { descriptorName: 'Inflammation' }],
  abstractText: 'Gut microbiota regulates bile acid metabolism. Lactobacillus produces indole-3-lactic acid. Short chain fatty acids promote host immunity. Microbiota modulates inflammation. The host-microbiota interaction plays a crucial role in maintaining homeostasis, and microbial tryptophan metabolites are potent modulators of host physiology.',
}

// A: keyword extraction
const ek = await tools.pubmed_extract_keywords.execute({ articles: [article], maxKeywords: 20 }, S('a'))
const kws = ek.articles[0].keywords
console.log('A) NLP keywords (' + kws.length + '): ' + kws.slice(0, 12).map((k) => k.word + '(' + k.count + ')').join(', '))
if (kws.length < 8) { console.log('KEYWORDS FAIL'); process.exit(1) }

// B: graph with relation edges
await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('a'))
await tools.pubmed_graph_add.execute({ articles: [article] }, S('a'))
const g = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('a'))
const relEdges = g.session.edges.filter((e) => e.kind === 'relation')
console.log('B) graph -> nodes=' + g.session.stats.nodeCount + ' edges=' + g.session.stats.edgeCount + ' relationEdges=' + relEdges.length)
for (const e of relEdges.slice(0, 8)) {
  console.log('   [' + e.label + '] ' + e.source.replace('kw:', '') + ' -> ' + e.target.replace('kw:', ''))
}
if (relEdges.length < 1) { console.log('RELATIONS FAIL'); process.exit(1) }
console.log('NLP TEST OK — keywords(A) + directed relations(B) verified')
