// batch-flags-test.mjs — P4 批次一验证：
//   A) mergeGraph 批量预取：150 篇 → 恰 2 次 PubTator 调用（100+50），
//      全部概念入图，探测预算 ≤8 篇（P0 二.1）
//   B) parseBool 统一：YAML 字符串 'false' 不再被误开（P4-一.5）
//   C) EUROPEPMC_ENABLED / NCBI_ADMIN_EMAIL 配置生效（P4-三.2）
//   D) fetch_fulltext 互斥校验（P4-二.3）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(30000) })

const MED = [
  'PMID- 12345',
  'TI  - Batch test article about metformin.',
  'AB  - Metformin modulates AMPK signaling in cardiomyocytes.',
  'JT  - Test Journal',
  'DP  - 2024',
].join('\n')
const ESPELL_XML = '<eSpellResult><Query>x</Query><CorrectedQuery>x</CorrectedQuery></eSpellResult>'

// pubtator3-api export mock: dynamically generates one Gene doc per requested pmid
function pubtatorDocsFor(u) {
  const m = decodeURIComponent(u).match(/pmids=([^&]+)/)
  const ids = m ? m[1].split(',') : []
  return {
    PubTator3: ids.map((id) => ({
      id,
      passages: [{ infons: {}, annotations: [{ infons: { identifier: 'G' + id, type: 'Gene', database: 'ncbi_gene', accession: '@GENE_G' + id }, text: 'G', locations: [] }] }],
    })),
  }
}

function makeTools(opts = {}) {
  const tools = {}
  const urls = []
  const sleeps = []
  registerPubmedTools({ get: () => undefined }, {
    defineTool: (o) => o,
    register: (d) => { tools[d.name] = d },
    httpGet: async (url) => {
      const u = String(url)
      urls.push(u)
      if (u.includes('/entrez/eutils/')) {
        if (u.includes('espell')) return { status: 200, body: ESPELL_XML }
        return { status: 200, body: MED }
      }
      if (u.includes('/publications/export/biocjson')) return { status: 200, body: JSON.stringify(pubtatorDocsFor(u)) }
      if (u.includes('/relations')) return { status: 200, body: '[]' }
      if (u.includes('/search/')) return { status: 200, body: JSON.stringify({ results: [], hitCount: 0 }) }
      return { status: 200, body: '{}' }
    },
    sleep: (ms) => { sleeps.push(ms); return Promise.resolve() },
    ...opts,
  })
  return { tools, urls, sleeps }
}
const checks = []
const add = (name, ok) => checks.push([name, ok])

// ---- A: batched prefetch + probe budget ----
{
  const { tools, urls } = makeTools()
  await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('bf'))
  const articles = Array.from({ length: 150 }, (_, i) => ({ pmid: String(900001 + i), title: 'Batch article ' + i, abstractText: 'Biomarker ' + i + ' modulates a pathway.' }))
  await tools.pubmed_graph_add.execute({ articles }, S('bf'))
  const exportUrls = urls.filter((u) => u.includes('/publications/export/biocjson'))
  const batchSizes = exportUrls.map((u) => decodeURIComponent(u.split('pmids=')[1].split('&')[0]).split(',').length)
  const relUrls = urls.filter((u) => u.includes('/relations')).length
  const searchUrls = urls.filter((u) => u.includes('/search/')).length
  const g = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('bf'))
  console.log('A exportCalls=' + exportUrls.length + ' batchSizes=' + JSON.stringify(batchSizes) + ' concepts=' + g.session.stats.concepts + ' relProbes=' + relUrls + ' evSearches=' + searchUrls)
  add('A 150 articles → exactly 2 batched PubTator calls', exportUrls.length === 2)
  add('A each batch ≤100 pmids (100+50)', batchSizes.join(',') === '100,50')
  add('A all 150 concepts present', g.session.stats.concepts === 150)
  add('A relation probing capped at 8 articles', relUrls === 8)
  add('A evidence searches capped (≤16)', searchUrls <= 16)
}

// ---- B: parseBool — YAML string "false" must NOT enable (P4-一.5) ----
{
  const B = makeTools({ autoGraph: false })
  await B.tools.pubmed_graph_reset.execute({ scope: 'session' }, S('bf'))
  await B.tools.pubmed_fetch_articles.execute({ pmids: ['12345'] }, S('bf'))
  const g1 = await B.tools.pubmed_graph_get.execute({ scope: 'session' }, S('bf'))
  console.log('B AUTO_GRAPH:"false" → nodes=' + g1.session.stats.nodeCount)
  add('B quoted "false" disables AUTO_GRAPH (was mis-enabled before)', g1.session.stats.nodeCount === 0)

  const C = makeTools({ autoGraph: true })
  await C.tools.pubmed_graph_reset.execute({ scope: 'session' }, S('bf'))
  await C.tools.pubmed_fetch_articles.execute({ pmids: ['12345'] }, S('bf'))
  const g2 = await C.tools.pubmed_graph_get.execute({ scope: 'session' }, S('bf'))
  add('B control: AUTO_GRAPH true still auto-merges', g2.session.stats.nodeCount > 0)
}

// ---- C: EUROPEPMC_ENABLED gate + NCBI_ADMIN_EMAIL (P4-三.2) ----
{
  const gated = makeTools({ europepmcEnabled: false })
  add('C EUROPEPMC_ENABLED:false unregisters EPM tools', !gated.tools.pubmed_europepmc_search && !gated.tools.pubmed_europepmc_fetch)
  add('C other tools still registered', !!gated.tools.pubmed_search_articles)

  const withMail = makeTools({ ncbiEmail: 'test@example.com' })
  await withMail.tools.pubmed_spell_check.execute({ query: 'x' }, S('bf'))
  const espellUrl = withMail.urls.find((u) => u.includes('espell')) || ''
  add('C NCBI_ADMIN_EMAIL reaches esearch/espell URL', decodeURIComponent(espellUrl).includes('email=test@example.com'))
}

// ---- E: parseBool unit (exported from lib/index.js) ----
{
  const mod = await import('../lib/index.js')
  add('E parseBool("false") === false', mod.parseBool('false', true) === false)
  add('E parseBool("0") === false', mod.parseBool('0', true) === false)
  add('E parseBool("true") === true', mod.parseBool('true', false) === true)
  add('E parseBool(undefined) → default', mod.parseBool(undefined, true) === true && mod.parseBool(undefined, false) === false)
}

// ---- F: prefetch failure must NOT poison the session cache (P4-二.1 修复) ----
// Phase 1: a graph_add whose prefetch fails on ALL retry attempts (network
// down) — must cache nothing. Phase 2: network recovered — the next graph_add
// must retry the fetch and land the concepts (old code trusted poisoned nulls
// and never retried).
{
  let phase = 1
  let exportCalls = 0
  const { tools, urls } = makeTools({
    // NOTE: pass an opts OBJECT (not a bare function) — opts.httpGet must
    // override makeTools' default router for the assertions below to hold.
    httpGet: async (url) => {
      const u = String(url)
      urls.push(u)
      if (u.includes('/publications/export/biocjson')) {
        exportCalls++
        if (phase === 1) throw netErr('ECONNRESET')
        return { status: 200, body: JSON.stringify(pubtatorDocsFor(u)) }
      }
      return { status: 200, body: MED }
    },
  })
  const art = [{ pmid: '55500001', title: 'Poisoning regression article' }]
  await tools.pubmed_graph_add.execute({ articles: art }, S('bf'))
  const afterCall1 = (await tools.pubmed_graph_get.execute({ scope: 'session' }, S('bf'))).session.stats.concepts
  phase = 2
  const before = urls.length
  await tools.pubmed_graph_add.execute({ articles: art }, S('bf'))
  const retryCalls = urls.slice(before).filter((u) => u.includes('/publications/export/biocjson')).length
  const g = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('bf'))
  console.log('F DEBUG: retryCalls=' + retryCalls + ' totalExport=' + exportCalls + ' conceptsAfter1=' + afterCall1 + ' conceptsAfter2=' + g.session.stats.concepts)
  console.log('F DEBUG urls after before:', JSON.stringify(urls.slice(before), null, 1).slice(0, 600))
  console.log('F DEBUG concept nodes:', JSON.stringify(g.session.nodes.filter((n) => n.type === 'concept').map((n) => n.id)))
  add('F failed prefetch does not poison cache (0 concepts after call 1)', afterCall1 === 0)
  add('F next graph_add retries the fetch (1 call)', retryCalls === 1)
  add('F concepts land after retried prefetch', g.session.stats.concepts === 1)
}

// ---- D: fetch_fulltext mutual exclusion (P4-二.3) ----
{
  const { tools } = makeTools()
  let both = '', none = ''
  try { await tools.pubmed_fetch_fulltext.execute({ pmids: ['123'], dois: ['10.1/x'] }, S('bf')) } catch (e) { both = String(e.message) }
  try { await tools.pubmed_fetch_fulltext.execute({}, S('bf')) } catch (e) { none = String(e.message) }
  add('D pmids+dois together throws mutual-exclusion error', /mutually exclusive/.test(both))
  add('D empty call throws provide-one-group error', /Provide pmids/.test(none))
}

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks.some(([, ok]) => !ok)) { console.log('BATCH/FLAGS FAIL'); process.exit(1) }
console.log('BATCH/FLAGS TEST OK')
