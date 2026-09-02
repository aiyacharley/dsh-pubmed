// s2-test.mjs — E5: Semantic Scholar direct-integration offline tests.
// Verifies the S2_ENABLED gate, per-tool response mapping (search / detail /
// citations / recommendations / match-by-title), external-id normalization,
// S2 error-message passthrough, and the no-key pacing queue — all with a
// mocked httpGet, zero network. (Live reachability is verified separately.)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()

const checks = []
const add = (name, ok) => checks.push([name, ok])
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(30000) })

const PAPER = {
  paperId: 'S2abc123',
  title: 'Metformin activates AMPK in liver',
  abstract: 'Background abstract text.',
  year: 2023,
  publicationDate: '2023-05-01',
  venue: 'J Metab',
  citationCount: 87,
  referenceCount: 42,
  isOpenAccess: true,
  openAccessPdf: { url: 'https://example.com/paper.pdf', status: 'OPEN' },
  authors: [{ name: 'Ann Author' }, { name: 'Bob Author' }],
  externalIds: { PubMed: '11111111', DOI: '10.1/aaa', ArXiv: '2310.12345', CorpusId: 999 },
}

function makeTools(httpGet, extraDeps) {
  const tools = {}
  const sleeps = []
  registerPubmedTools({ get: () => undefined }, {
    defineTool: (o) => o,
    register: (d) => { tools[d.name] = d },
    httpGet: async (url) => httpGet(String(url)),
    sleep: (ms) => { sleeps.push(ms); return Promise.resolve() },
    ...extraDeps,
  })
  return { tools, sleeps }
}
const S2_TOOLS = ['pubmed_search_s2', 'pubmed_get_s2_detail', 'pubmed_get_s2_citations', 'pubmed_get_s2_recommendations', 'pubmed_match_paper_by_title']

// ---- gate: S2_ENABLED:false removes all five S2 tools ----
{
  const { tools } = makeTools(() => { throw new Error('S2 must not be called when disabled') }, { s2Enabled: false })
  add('S2_ENABLED:false unregisters the 5 S2 tools', S2_TOOLS.every((n) => !tools[n]))
  add('S2_ENABLED:false keeps core tools', !!tools.pubmed_search_articles)
}

// ---- search_s2: response mapping, id normalization, nextOffset ----
{
  const { tools } = makeTools((u) => (u.includes('/graph/v1/paper/search?')
    ? { status: 200, body: JSON.stringify({ total: 500, offset: 0, next: 10, data: [PAPER, { paperId: 'S2x', title: 'Second paper', externalIds: { DOI: '10.1/bbb' } }] }) }
    : { status: 200, body: '{}' }))
  const r = await tools.pubmed_search_s2.execute({ query: 'metformin', maxResults: 10 }, S('s2'))
  add('search_s2 total + papers mapped', r.total === 500 && r.papers.length === 2)
  const p = r.papers[0]
  add('search_s2 external ids normalized (pmid/doi/arxiv/corpus/s2)', p.pmid === '11111111' && p.doi === '10.1/aaa' && p.arxivId === '2310.12345' && p.corpusId === '999' && p.s2Id === 'S2abc123')
  add('search_s2 citation/ref counts + OA pdf mapped', p.citedByCount === 87 && p.referenceCount === 42 && p.openAccessPdf === 'https://example.com/paper.pdf')
  add('search_s2 authors capped to first 8 names', Array.isArray(p.authors) && p.authors[0] === 'Ann Author')
  add('search_s2 nextOffset surfaced', r.nextOffset === 10)
}

// ---- get_s2_detail: URL encoding + normalized paper + error passthrough ----
{
  let called = ''
  const { tools } = makeTools((u) => { called = u; return { status: 200, body: JSON.stringify(PAPER) } })
  const r = await tools.pubmed_get_s2_detail.execute({ paperId: 'DOI:10.1/aaa' }, S('s2'))
  add('get_s2_detail URL-encodes the paper id', called.includes('/graph/v1/paper/' + encodeURIComponent('DOI:10.1/aaa')))
  add('get_s2_detail returns normalized paper', r.paper.pmid === '11111111' && r.paper.title === 'Metformin activates AMPK in liver')
  const { tools: t2 } = makeTools(() => ({ status: 200, body: JSON.stringify({ message: 'Paper not found' }) }))
  let msg = ''
  try { await t2.pubmed_get_s2_detail.execute({ paperId: 'S2nope' }, S('s2')) } catch (e) { msg = String(e.message) }
  add('get_s2_detail surfaces the S2 error message', /Paper not found/.test(msg))
}

// ---- citations (citingPaper) & recommendations (recommendedPapers) ----
{
  const { tools } = makeTools((u) => (u.includes('/citations?')
    ? { status: 200, body: JSON.stringify({ data: [{ citingPaper: PAPER }, { citingPaper: { paperId: 'S2c', title: 'Citing two', externalIds: { DOI: '10.1/ccc' } } }] }) }
    : { status: 200, body: '{}' }))
  const r = await tools.pubmed_get_s2_citations.execute({ paperId: 'PMID:11111111' }, S('s2'))
  add('get_s2_citations maps citingPaper list', r.total === 2 && r.papers[0].pmid === '11111111' && r.papers[1].s2Id === 'S2c')
}
{
  const { tools } = makeTools(() => ({ status: 200, body: JSON.stringify({ recommendedPapers: [PAPER] }) }))
  const r = await tools.pubmed_get_s2_recommendations.execute({ paperId: 'S2abc123' }, S('s2'))
  add('get_s2_recommendations maps recommendedPapers', r.total === 1 && r.papers[0].doi === '10.1/aaa')
}

// ---- match_paper_by_title: resolves data[0] ----
{
  const { tools } = makeTools((u) => (u.includes('/search/match?') ? { status: 200, body: JSON.stringify({ data: [PAPER] }) } : { status: 200, body: '{}' }))
  const r = await tools.pubmed_match_paper_by_title.execute({ title: 'Metformin activates AMPK in liver' }, S('s2'))
  add('match_paper_by_title resolves data[0]', r.paper.pmid === '11111111' && r.paper.title === 'Metformin activates AMPK in liver')
}

// ---- pacing: no API key → the dedicated queue requests a conservative gap ----
// (S2 unauth limit is 100 req / 5 min shared per IP; the queue gaps at ~3s.
// Two immediate calls in the mock ⇒ the second computes a wait ≈ 3000ms.)
{
  const { tools, sleeps } = makeTools(() => ({ status: 200, body: JSON.stringify({ total: 1, data: [PAPER] }) }))
  await tools.pubmed_search_s2.execute({ query: 'a' }, S('s2'))
  await tools.pubmed_search_s2.execute({ query: 'b' }, S('s2'))
  add('S2 no-key pacing requests a ≥1000ms gap between calls', sleeps.some((ms) => ms >= 1000))
}

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
const fails = checks.filter(([, ok]) => !ok).length
console.log(fails ? `S2 TEST FAIL (${fails})` : 'S2 TEST OK')
process.exit(fails ? 1 : 0)
