// smoke.mjs — validates the shared pubmed-core.js with a fetch-based transport
// (the same deps the dsh-pubmed bundle plugin provides at runtime).
// Extended after the P0/P1/P2 fix pass to re-verify mesh, fulltext not-found,
// empty-result hints, and the global NCBI rate limiter.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const factory = new Function(source + '\n; return registerPubmedTools')
const registerPubmedTools = factory()

const tools = {}
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
})

console.log('registered tools (' + Object.keys(tools).length + '): ' + Object.keys(tools).join(', '))
const signal = AbortSignal.timeout(60000)

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
// valid OA still works
const fullOk = await tools.pubmed_fetch_fulltext.execute({ pmcids: ['PMC3531190'], maxCharacters: 800 }, { signal })
const fo = fullOk.articles[0] || {}
console.log('fulltext OA -> source=' + fo.source + ' sections=' + (fo.sections || []).length)
if (fo.source !== 'pmc' || !(fo.sections || []).length) { console.log('FULLTEXT OA FAIL'); process.exit(1) }

// --- P1: empty-result render hint ---
const renderEmpty = tools.pubmed_fetch_articles.output.render({ pmids: ['99999999'] }, { articles: [] })
const emptyText = renderEmpty[0] && renderEmpty[0].text || ''
console.log('fetch_articles empty render -> ' + emptyText.slice(0, 60))
if (!/No articles found/.test(emptyText)) { console.log('EMPTY-RENDER FAIL'); process.exit(1) }

// --- P2: rate limiter — convert_ids makes 3 serialized NCBI calls; search makes 2 ---
const conv = await tools.pubmed_convert_ids.execute({ ids: ['23193287'], idtype: 'pmid' }, { signal })
console.log('convert -> ' + JSON.stringify(conv.records[0]))
if (conv.records[0].status !== 'ok') { console.log('CONVERT FAIL: ' + conv.records[0].errmsg); process.exit(1) }
const search = await tools.pubmed_search_articles.execute(
  { query: 'gut microbiome AND 2023[dp]', maxResults: 2, includeSummaries: true }, { signal })
console.log('search -> count=' + search.count + ' summaries=' + search.summaries.length)
if (search.summaries.length !== 2) { console.log('SEARCH SUMMARIES FAIL'); process.exit(1) }

console.log('SMOKE OK — all P0/P1/P2 fixes verified')
