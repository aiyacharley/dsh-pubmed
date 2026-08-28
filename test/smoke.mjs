// smoke.mjs — validates the shared pubmed-core.js with a fetch-based transport
// (the same deps the dsh-pubmed bundle plugin provides at runtime).
// Covers: P0/P1/P2 robustness fixes + the P1 knowledge-graph engine.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const factory = new Function(source + '\n; return registerPubmedTools')
const registerPubmedTools = factory()

const tools = {}
// In-memory stand-in for the bundle's file-backed user-graph persistence.
let userGraph = null
const storage = {
  loadUserGraph: () => (userGraph ? JSON.parse(JSON.stringify(userGraph)) : null),
  saveUserGraph: (g) => { userGraph = JSON.parse(JSON.stringify(g)); return true },
  clearUserGraph: () => { userGraph = null; return true },
}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (opts) => opts,
  register: (def) => { tools[def.name] = def },
  httpGet: (url, signal, timeoutMs) =>
    fetch(url, { signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-pubmed/1.0)' } }).then(async (res) => {
      const body = await res.text()
      if (res.status >= 400) throw new Error('HTTP ' + res.status + ' from ' + String(url).split('?')[0])
      return { status: res.status, body }
    }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  storage,
})

console.log('registered tools (' + Object.keys(tools).length + '): ' + Object.keys(tools).join(', '))
const signal = AbortSignal.timeout(60000)
const S = (id) => ({ agent: { id }, signal })

// --- P0: lookup_mesh now returns details ---
const mesh = await tools.pubmed_lookup_mesh.execute({ query: 'Microbiota', maxResults: 2 }, { signal })
console.log('mesh -> count=' + mesh.count + ' results=' + mesh.results.length)
const m0 = mesh.results[0] || {}
console.log('  [0] ui=' + m0.ui + ' name=' + m0.name +
  ' trees=' + (m0.treeNumbers || []).length + ' scopeNote=' + (m0.scopeNote ? 'yes' : 'no') +
  ' entryTerms=' + (m0.entryTerms || []).length)
if (!mesh.results.length || !m0.name) { console.log('MESH FAIL'); process.exit(1) }

// --- P1: fetch_fulltext invalid PMCID → unavailable not-found ---
const full = await tools.pubmed_fetch_fulltext.execute({ pmcids: ['PMC99999999'], maxCharacters: 1500 }, { signal })
const fa = full.articles[0] || {}
console.log('fulltext invalid -> source=' + fa.source + ' unavailable=' + fa.unavailable)
if (fa.unavailable !== 'not-found') { console.log('FULLTEXT NOT-FOUND FAIL'); process.exit(1) }
const fullOk = await tools.pubmed_fetch_fulltext.execute({ pmcids: ['PMC3531190'], maxCharacters: 800 }, { signal })
const fo = fullOk.articles[0] || {}
console.log('fulltext OA -> source=' + fo.source + ' sections=' + (fo.sections || []).length)
if (fo.source !== 'pmc' || !(fo.sections || []).length) { console.log('FULLTEXT OA FAIL'); process.exit(1) }

// --- P1: empty-result render hint ---
const renderEmpty = tools.pubmed_fetch_articles.output.render({ pmids: ['99999999'] }, { articles: [] })
const emptyText = renderEmpty[0] && renderEmpty[0].text || ''
console.log('fetch_articles empty render -> ' + emptyText.slice(0, 60))
if (!/No articles found/.test(emptyText)) { console.log('EMPTY-RENDER FAIL'); process.exit(1) }

// --- P2: rate limiter — convert_ids (3 serialized NCBI calls) + search+summaries ---
const conv = await tools.pubmed_convert_ids.execute({ ids: ['23193287'], idtype: 'pmid' }, { signal })
console.log('convert -> ' + JSON.stringify(conv.records[0]))
if (conv.records[0].status !== 'ok') { console.log('CONVERT FAIL: ' + conv.records[0].errmsg); process.exit(1) }
const search = await tools.pubmed_search_articles.execute(
  { query: 'gut microbiome AND 2023[dp]', maxResults: 2, includeSummaries: true }, { signal })
console.log('search -> count=' + search.count + ' summaries=' + search.summaries.length)
if (search.summaries.length !== 2) { console.log('SEARCH SUMMARIES FAIL'); process.exit(1) }

// ============ P1 knowledge-graph engine ============
// fetch two real articles to feed the graph
const articles = (await tools.pubmed_fetch_articles.execute({ pmids: ['37054671', '36253479'] }, { signal })).articles
console.log('fetched articles for graph: ' + articles.length)
if (articles.length !== 2) { console.log('GRAPH FETCH FAIL'); process.exit(1) }

// extract keywords
const ek = await tools.pubmed_extract_keywords.execute({ articles: articles.slice(0, 1), maxKeywords: 10 }, { signal })
const kwCount = ek.articles[0].keywords.length
console.log('extract keywords[0] count=' + kwCount + ' top=' + (ek.articles[0].keywords[0] || {}).word)
if (kwCount < 3) { console.log('EXTRACT FAIL'); process.exit(1) }

// session graph: incremental adds in session A
const add1 = await tools.pubmed_graph_add.execute({ articles: articles.slice(0, 1) }, S('sess-A'))
console.log('add[0] -> nodes=' + add1.stats.nodeCount + ' edges=' + add1.stats.edgeCount + ' (+' + add1.addedNodes + 'n/+' + add1.addedEdges + 'e)')
if (add1.stats.nodeCount < 3) { console.log('GRAPH ADD1 FAIL'); process.exit(1) }
const add2 = await tools.pubmed_graph_add.execute({ articles: articles.slice(1) }, S('sess-A'))
console.log('add[1] (incremental) -> nodes=' + add2.stats.nodeCount + ' edges=' + add2.stats.edgeCount)
if (add2.stats.nodeCount <= add1.stats.nodeCount) { console.log('GRAPH ADD2 FAIL'); process.exit(1) }

// session isolation: another session starts empty
const iso = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('sess-B'))
console.log('session B (isolation) -> nodes=' + iso.session.stats.nodeCount + ' (expect 0)')
if (iso.session.stats.nodeCount !== 0) { console.log('SESSION ISOLATION FAIL'); process.exit(1) }

// commit session A -> user graph (opt-in)
const commit = await tools.pubmed_graph_commit.execute({ confirm: true }, S('sess-A'))
console.log('commit -> committed=' + commit.committed + ' user.nodes=' + commit.stats.nodeCount + ' user.edges=' + commit.stats.edgeCount)
if (!commit.committed || commit.stats.nodeCount < 3) { console.log('COMMIT FAIL'); process.exit(1) }

// user graph persists (loadUserGraph returns the saved copy)
const userG = await tools.pubmed_graph_get.execute({ scope: 'user' }, S('other'))
console.log('user graph -> nodes=' + userG.user.stats.nodeCount + ' articles=' + userG.user.stats.articles + ' keywords=' + userG.user.stats.keywords)
if (!userG.user.nodes.length) { console.log('USER GRAPH FAIL'); process.exit(1) }

// reset session
const reset = await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('sess-A'))
const after = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('sess-A'))
console.log('reset session A -> ' + reset.cleared + '; after nodes=' + after.session.stats.nodeCount + ' (expect 0)')
if (after.session.stats.nodeCount !== 0) { console.log('RESET FAIL'); process.exit(1) }

console.log('SMOKE OK — P0/P1/P2 + P1 graph engine verified')
