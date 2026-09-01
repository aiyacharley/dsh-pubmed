// graph-test.mjs — P1 knowledge-graph engine test with SYNTHETIC article data
// (no network needed — the graph engine is pure in-memory + storage).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const factory = new Function(source + '\n; return registerPubmedTools')
const registerPubmedTools = factory()

const tools = {}
let userGraph = null
const storage = {
  loadUserGraph: () => (userGraph ? JSON.parse(JSON.stringify(userGraph)) : null),
  saveUserGraph: (g) => { userGraph = JSON.parse(JSON.stringify(g)); return true },
  clearUserGraph: () => { userGraph = null; return true },
}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (opts) => opts,
  register: (def) => { tools[def.name] = def },
  httpGet: async () => { throw new Error('network not used in this test') },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  storage,
})

const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(5000) })

// synthetic articles (share some keywords so co-occurrence forms)
const a1 = {
  pmid: '11111111', doi: '10.1/a', title: 'Gut microbiota metabolism and bile acids in metabolic disease',
  abstractText: 'The gut microbiome regulates bile acid metabolism and interacts with host metabolic pathways. Microbiota derived metabolites shape disease risk.',
  meshTerms: [{ descriptorName: 'Gastrointestinal Microbiome' }, { descriptorName: 'Bile Acids and Salts' }, { descriptorName: 'Metabolic Diseases' }],
}
const a2 = {
  pmid: '22222222', doi: '10.2/b', title: 'Short chain fatty acids and gut microbiota cross feeding',
  abstractText: 'Cross feeding between gut microbes produces short chain fatty acids. Microbiota metabolism influences host immunity and metabolic health.',
  meshTerms: [{ descriptorName: 'Fatty Acids, Volatile' }, { descriptorName: 'Gastrointestinal Microbiome' }, { descriptorName: 'Host Microbial Interactions' }],
}
const a3 = {
  pmid: '33333333', doi: '10.3/c', title: 'Bile acids in liver disease and the microbiome',
  abstractText: 'Bile acid signaling and gut microbiota alterations drive liver disease progression and metabolic dysfunction.',
  meshTerms: [{ descriptorName: 'Bile Acids and Salts' }, { descriptorName: 'Liver Diseases' }, { descriptorName: 'Gastrointestinal Microbiome' }],
}

// 1) extract
const ek = await tools.pubmed_extract_keywords.execute({ articles: [a1], maxKeywords: 8 }, S('sA'))
const k1 = ek.articles[0].keywords
console.log('extract[0] -> ' + k1.length + ' keywords: ' + k1.slice(0, 6).map((x) => x.word + '(' + x.count + ')').join(', '))
if (k1.length < 3 || !k1.some((x) => x.word === 'microbiota')) { console.log('EXTRACT FAIL'); process.exit(1) }

// 2) incremental session build in session A
const add1 = await tools.pubmed_graph_add.execute({ articles: [a1] }, S('sA'))
console.log('add[a1] -> nodes=' + add1.stats.nodeCount + ' edges=' + add1.stats.edgeCount)
const add2 = await tools.pubmed_graph_add.execute({ articles: [a2] }, S('sA'))
console.log('add[a2] -> nodes=' + add2.stats.nodeCount + ' edges=' + add2.stats.edgeCount + ' (incremental)')
const add3 = await tools.pubmed_graph_add.execute({ articles: [a3] }, S('sA'))
console.log('add[a3] -> nodes=' + add3.stats.nodeCount + ' edges=' + add3.stats.edgeCount)
if (!(add3.stats.nodeCount > add2.stats.nodeCount && add2.stats.nodeCount > add1.stats.nodeCount)) { console.log('INCREMENT FAIL'); process.exit(1) }

// 2b) dryRun previews without mutating the session graph
const nodesBefore = (await tools.pubmed_graph_get.execute({ scope: 'session' }, S('sA'))).session.stats.nodeCount
const dr = await tools.pubmed_graph_add.execute({ articles: [{ pmid: '99999999', title: 'Dry run synthetic article about proteomics biomarkers', abstractText: 'Proteomics biomarkers drive discovery.' }], dryRun: true }, S('sA'))
const nodesAfter = (await tools.pubmed_graph_get.execute({ scope: 'session' }, S('sA'))).session.stats.nodeCount
console.log('dryRun -> wouldAddNodes=' + dr.wouldAddNodes + ' wouldAddEdges=' + dr.wouldAddEdges + ' nodes ' + nodesBefore + '->' + nodesAfter)
if (!(dr.dryRun === true && dr.wouldAddNodes > 0 && nodesAfter === nodesBefore)) { console.log('DRYRUN FAIL'); process.exit(1) }

// 3) session isolation (session B empty)
const isoB = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('sB'))
console.log('session B nodes -> ' + isoB.session.stats.nodeCount + ' (expect 0)')
if (isoB.session.stats.nodeCount !== 0) { console.log('ISOLATION FAIL'); process.exit(1) }

// 4) get session A: directed article->keyword + undirected co-occur present
const gA = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('sA'))
const kinds = new Set(gA.session.edges.map((e) => e.kind))
console.log('session A -> nodes=' + gA.session.stats.nodeCount + ' edges=' + gA.session.stats.edgeCount + ' kinds=' + [...kinds].join(','))
if (!kinds.has('article-keyword') || !kinds.has('co-occur')) { console.log('EDGE KINDS FAIL'); process.exit(1) }
const kwNode = gA.session.nodes.find((n) => n.type === 'keyword' && n.label === 'microbiota')
console.log('kw "microbiota" -> count=' + (kwNode && kwNode.count) + ' sources=' + (kwNode && kwNode.sources.length))
if (!kwNode || kwNode.count < 3) { console.log('KEYWORD MERGE FAIL'); process.exit(1) }

// 5) commit session A -> user graph (persisted via in-memory storage)
const commit = await tools.pubmed_graph_commit.execute({ confirm: true }, S('sA'))
console.log('commit -> committed=' + commit.committed + ' user.nodes=' + commit.stats.nodeCount)
if (!commit.committed) { console.log('COMMIT FAIL'); process.exit(1) }
// user graph visible from another session
const gU = await tools.pubmed_graph_get.execute({ scope: 'user' }, S('sB'))
console.log('user graph -> nodes=' + gU.user.stats.nodeCount + ' articles=' + gU.user.stats.articles + ' keywords=' + gU.user.stats.keywords)
if (!gU.user.nodes.length) { console.log('USER PERSIST FAIL'); process.exit(1) }

// 6) double commit is idempotent-ish (merges, doesn't corrupt)
const commit2 = await tools.pubmed_graph_commit.execute({ confirm: true }, S('sA'))
console.log('commit(2nd) -> user.nodes=' + commit2.stats.nodeCount + ' addedNodes=' + commit2.addedNodes)

// 7) reset session A
await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('sA'))
const afterReset = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('sA'))
console.log('reset session A -> nodes=' + afterReset.session.stats.nodeCount + ' (expect 0)')
if (afterReset.session.stats.nodeCount !== 0) { console.log('RESET FAIL'); process.exit(1) }

// 8) reset user graph
await tools.pubmed_graph_reset.execute({ scope: 'user' }, S('any'))
const gU2 = await tools.pubmed_graph_get.execute({ scope: 'user' }, S('any'))
console.log('reset user -> nodes=' + gU2.user.stats.nodeCount + ' (expect 0)')
if (gU2.user.stats.nodeCount !== 0) { console.log('USER RESET FAIL'); process.exit(1) }

console.log('GRAPH TEST OK — extract/increment/isolation/commit/persist/reset all pass')
