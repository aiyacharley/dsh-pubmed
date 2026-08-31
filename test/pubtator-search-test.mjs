// pubtator-search-test.mjs — pubmed_pubtator_search (P0): response parsing per
// the probed DRF envelope, relations-query convenience assembly, pagination,
// graceful degradation on non-JSON bodies, lossless output.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(10000) })

// Fixture mirrors the REAL probed response shape (www.ncbi.nlm.nih.gov
// /research/pubtator3-api/search/, DRF-paginated).
const FIXTURE = {
  results: [
    {
      _id: '37711410', pmid: 37711410, title: 'Remdesivir.', journal: 'Hosp Pharm',
      authors: ['Levien TL', 'Baker DE'], date: '2023-10-01T00:00:00Z',
      doi: '10.1177/0018578721999804', meta_date_publication: '2023 Oct',
      score: 266.24747,
      text_hl: '@<m>CHEMICAL_remdesivir</m> @CHEMICAL_MESH:C000606551 @@@Remdesivir@@@.',
      citations: { NLM: 'Levien TL, Baker DE. Remdesivir.', BibTeX: '@article{37711410,}' },
    },
    {
      _id: '37061276', pmid: 37061276, pmcid: 'PMC9910426', title: 'Remdesivir',
      journal: 'Profiles Drug Subst Excip Relat Methodol', authors: ['Bakheit AH'],
      date: '2023-01-01T00:00:00Z', score: 265.64862,
      text_hl: 'Assessing @<m>CHEMICAL_remdesivir</m> @@@remdesivir@@@',
    },
  ],
  facets: {
    facet_fields: {
      journal: [{ name: 'Cureus', type: 'int', value: 616 }],
      type: [{ name: 'Journal Article', type: 'int', value: 20305 }],
      year: [{ name: '2021', type: 'int', value: 6595 }, { name: '2022', type: 'int', value: 6192 }],
    },
  },
  page_size: 10, current: 2, count: 23289, total_pages: 2329,
}

function makeTools(fixture, capture) {
  const tools = {}
  registerPubmedTools({ get: () => undefined }, {
    defineTool: (o) => o,
    register: (d) => { tools[d.name] = d },
    httpGet: async (url) => { capture.push(String(url)); return { status: 200, body: JSON.stringify(fixture) } },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
  return tools
}
const decoded = (url) => new URL(url).searchParams
function walk(v) {
  if (Array.isArray(v)) return v.every(walk)
  if (v !== null && typeof v === 'object') return Object.keys(v).every((k) => v[k] !== undefined && walk(v[k]))
  if (typeof v === 'number') return Number.isFinite(v)
  return true
}
const checks = []
const add = (name, ok) => checks.push([name, ok])

// ---- T1: free text + pagination ----
{
  const urls = []
  const tools = makeTools(FIXTURE, urls)
  const r = await tools.pubmed_pubtator_search.execute({ query: 'remdesivir', page: 2 }, S('ps'))
  const q = decoded(urls[urls.length - 1])
  console.log('T1 hits=' + r.totalCount + ' page=' + r.page + '/' + r.totalPages + ' shown=' + r.articleCount)
  add('T1 free text passes query through', q.get('text') === 'remdesivir')
  add('T1 page param forwarded', q.get('page') === '2')
  add('T1 envelope pagination parsed (current=2)', r.page === 2)
  add('T1 count parsed (23289)', r.totalCount === 23289)
  add('T1 total_pages parsed (2329)', r.totalPages === 2329)
  add('T1 2 articles', r.articleCount === 2)
  add('T1 pmid stringified', r.articles[0].pmid === '37711410')
  add('T1 pmcid passthrough', r.articles[1].pmcid === 'PMC9910426')
  add('T1 missing pmcid → null', r.articles[0].pmcid === null)
  add('T1 highlight tags stripped', !r.articles[0].snippet.includes('<m>') && r.articles[0].snippet.includes('Remdesivir'))
  add('T1 facets year top entries', r.facets.year.length === 2 && r.facets.year[0].name === '2021' && r.facets.year[0].count === 6595)
  add('T1 lossless', walk(r))
}

// ---- T2: convenience relations assembly (with e2) ----
// NOTE: no `query` property at all — mirrors the live framework call that
// v0.3.0 rejected because the schema then marked query as required (hotfixed
// in v0.3.1: query is optional when relationType + e1 are given).
{
  const urls = []
  const tools = makeTools(FIXTURE, urls)
  const r = await tools.pubmed_pubtator_search.execute({ relationType: 'treat', e1: '@CHEMICAL_Doxorubicin', e2: 'DISEASE' }, S('ps'))
  const q = decoded(urls[urls.length - 1])
  add('T2 assembles relations:treat|@CHEMICAL_Doxorubicin|DISEASE', q.get('text') === 'relations:treat|@CHEMICAL_Doxorubicin|DISEASE')
  add('T2 query echoed in result', r.query === 'relations:treat|@CHEMICAL_Doxorubicin|DISEASE')
  add('T2 works without a query property (v0.3.0 framework rejection regression)', q.has('text') && r.articleCount === 2)
}

// ---- T3: convenience relations assembly (e2 defaults to ANY) ----
{
  const urls = []
  const tools = makeTools(FIXTURE, urls)
  await tools.pubmed_pubtator_search.execute({ relationType: 'interact', e1: '@GENE_JAK1' }, S('ps'))
  const q = decoded(urls[urls.length - 1])
  add('T3 e2 defaults to ANY', q.get('text') === 'relations:interact|@GENE_JAK1|ANY')
}

// ---- T4: raw boolean query passthrough (spaces/@ encoded, unchanged) ----
{
  const urls = []
  const tools = makeTools(FIXTURE, urls)
  const raw = '@CHEMICAL_Doxorubicin AND @DISEASE_Neoplasms'
  await tools.pubmed_pubtator_search.execute({ query: raw }, S('ps'))
  const q = decoded(urls[urls.length - 1])
  add('T4 boolean query survives round-trip', q.get('text') === raw)
}

// ---- T5: empty query without relation parts → error ----
{
  const urls = []
  const tools = makeTools(FIXTURE, urls)
  let threw = false
  try { await tools.pubmed_pubtator_search.execute({ query: '   ' }, S('ps')) } catch (e) { threw = true }
  add('T5 empty query throws', threw)
}

// ---- T6: non-JSON body degrades gracefully ----
{
  const tools = {}
  registerPubmedTools({ get: () => undefined }, {
    defineTool: (o) => o,
    register: (d) => { tools[d.name] = d },
    httpGet: async () => ({ status: 200, body: '<html>gateway error</html>' }),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
  const r = await tools.pubmed_pubtator_search.execute({ query: 'cancer' }, S('ps'))
  add('T6 non-JSON → 0 articles, no throw', r.articleCount === 0 && r.totalCount === 0 && Array.isArray(r.articles))
  add('T6 lossless on degraded output', walk(r))
}

// ---- formatter smoke ----
{
  const urls = []
  const tools = makeTools(FIXTURE, urls)
  const r = await tools.pubmed_pubtator_search.execute({ query: 'remdesivir' }, S('ps'))
  const out = r.articles && r.totalCount != null
  add('F result shape stable', !!out)
}

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks.some(([, ok]) => !ok)) { console.log('PUBTATOR SEARCH FAIL'); process.exit(1) }
console.log('PUBTATOR SEARCH TEST OK')
