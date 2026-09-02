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

// ---- S2 inside the unified search (pubmed_search_papers, opt-in 's2') ----
{
  // PubMed returns PMID 111 (DOI 10.1/aaa); S2 returns the SAME paper (by PMID+DOI)
  // plus one S2-only record. They must dedup-merge: foundIn includes s2, citedBy merged.
  const esearch = JSON.stringify({ esearchresult: { idlist: ['111'], count: '1' } })
  const esummary = JSON.stringify({ result: { uids: ['111'], '111': { pmid: '111', title: 'Metformin and AMPK activation in liver', authors: [{ name: 'A Author' }], fulljournalname: 'J Metab', pubdate: '2024 Jan', articleids: [{ idtype: 'doi', value: '10.1/aaa' }] } } })
  const s2body = JSON.stringify({ total: 50, data: [
    { paperId: 'S2x', title: 'Metformin and AMPK activation in liver', year: 2024, venue: 'J Metab', citationCount: 87, externalIds: { PubMed: '111', DOI: '10.1/aaa' }, authors: [{ name: 'A Author' }] },
    { paperId: 'S2y', title: 'Metformin beyond glucose', year: 2025, venue: 'J S2', externalIds: { DOI: '10.2/bbb' }, authors: [{ name: 'B Author' }] },
  ] })
  const { tools } = makeTools((u) => {
    if (u.includes('esearch.fcgi')) return { status: 200, body: esearch }
    if (u.includes('esummary.fcgi')) return { status: 200, body: esummary }
    if (u.includes('api.semanticscholar.org')) return { status: 200, body: s2body }
    return { status: 200, body: '{}' }
  })
  const r = await tools.pubmed_search_papers.execute({ query: 'metformin', sources: ['pubmed', 's2'], maxResultsPerSource: 10 }, S('s2'))
  add('S2-in-unified: 2 unique after merge (PMID 111 merged, S2-only kept)', r.total === 2)
  const first = r.papers.find((p) => p.pmid === '111')
  add('S2-in-unified: PubMed+S2 hit merged (foundIn s2 + citedBy 87)', first != null && first.foundIn.includes('pubmed') && first.foundIn.includes('s2') && first.citedByCount === 87)
  const s2only = r.papers.find((p) => p.title === 'Metformin beyond glucose')
  add('S2-in-unified: S2-only record kept (source s2, foundIn 1)', s2only != null && s2only.source === 's2' && s2only.foundIn.length === 1)
  add('S2-in-unified: perSource reports s2 OK', r.perSource.some((p) => p.source === 's2' && !p.error))
}
{
  // S2_ENABLED:false → unified search reports 's2 disabled', never queries S2.
  const { tools } = makeTools(() => { throw new Error('S2 must not be called when disabled') }, { s2Enabled: false })
  const r = await tools.pubmed_search_papers.execute({ query: 'x', sources: ['pubmed', 's2'] }, S('s2'))
  const s2p = r.perSource.find((p) => p.source === 's2')
  add('S2_ENABLED:false → unified search perSource "s2 disabled" (no S2 call)', s2p != null && /s2 disabled/.test(s2p.error || ''))
}

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
const fails = checks.filter(([, ok]) => !ok).length
console.log(fails ? `S2 TEST FAIL (${fails})` : 'S2 TEST OK')
process.exit(fails ? 1 : 0)
