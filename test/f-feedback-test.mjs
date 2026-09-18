// f-feedback-test.mjs — regression tests for the live-testing feedback round:
// F1 search_articles includeSummaries defaults to true (schema default is NOT
//    auto-applied by the framework — the handler must apply it)
// F2 relation spans trimmed of stopword debris (no "they share similar" keyword nodes)
// F3 fetch_pdf_oa pmcid-that-is-actually-a-pmid reports an actionable note
// F6 find_related similar never returns the source article itself
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()

const checks = []
const add = (name, ok) => checks.push([name, ok])
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(30000) })

function makeTools(httpGet, extraDeps) {
  const tools = {}
  const urls = []
  registerPubmedTools({ get: () => undefined }, {
    defineTool: (o) => o,
    register: (d) => { tools[d.name] = d },
    httpGet: async (url) => { urls.push(String(url)); return httpGet(String(url)) },
    sleep: () => Promise.resolve(),
    ...extraDeps,
  })
  return { tools, urls }
}

// ---- F1: includeSummaries defaults to true when omitted ----
{
  const esearch = JSON.stringify({ esearchresult: { idlist: ['111', '222'], count: '2' } })
  const esummary = JSON.stringify({ result: { uids: ['111', '222'], '111': { pmid: '111', title: 'Paper one' }, '222': { pmid: '222', title: 'Paper two' } } })
  const { tools, urls } = makeTools((u) => {
    if (u.includes('esearch.fcgi')) return { status: 200, body: esearch }
    if (u.includes('esummary.fcgi')) return { status: 200, body: esummary }
    return { status: 200, body: '{}' }
  })
  const r = await tools.pubmed_search_articles.execute({ query: 'x' }, S('f')) // no includeSummaries
  add('F1: omitting includeSummaries still returns summaries (default true)', r.summaries.length === 2)
  add('F1: esummary was actually requested', urls.some((u) => u.includes('esummary.fcgi')))
  const r2 = await tools.pubmed_search_articles.execute({ query: 'x', includeSummaries: false }, S('f'))
  add('F1: explicit false still opts out', r2.summaries.length === 0)
}

// ---- F2: relation spans carry no stopword debris ----
{
  const article = {
    pmid: '1',
    title: 'Gut microbiota regulates bile acid metabolism',
    abstractText: 'They share similar features with the host. Microbial communities are shaped by diet. Lactobacillus produces indole that activates the aryl hydrocarbon receptor.',
  }
  const { tools } = makeTools(() => ({ status: 200, body: '{}' }))
  const dr = await tools.pubmed_graph_add.execute({ articles: [article], dryRun: true }, S('f'))
  // collect what WOULD become nodes via a real add, then inspect kw labels
  await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('f'))
  await tools.pubmed_graph_add.execute({ articles: [article] }, S('f'))
  const g = await tools.pubmed_graph_get.execute({ scope: 'session', format: 'json' }, S('f'))
  const labels = g.session.nodes.filter((n) => n.type === 'keyword').map((n) => n.label)
  const junk = labels.filter((l) => /^(and|are|by|they|with|the|of|to|in|that|which|is|was)\b/i.test(l) || /\b(share similar|communities are)\b/i.test(l))
  add('F2: no stopword-debris keyword nodes created', junk.length === 0)
  add('F2: valid relation endpoints still present (microbiota/bile acid metabolism)', labels.some((l) => l.includes('microbiota')) || g.session.edges.some((e) => e.kind === 'relation' && e.label === 'regulates'))
}

// ---- F3: pmcids param receiving a PMID reports an actionable note ----
{
  const { tools } = makeTools((u) => {
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: JSON.stringify({ resultList: { result: [] } }) } // PMCID unknown
    return { status: 200, body: '{}' }
  })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ pmcid: '37928369' }, S('f')) // a bare PMID passed as pmcid
  add('F3: not silently reported as "no OA copy"', !(r.isOpenAccess === false && r.locationCount === 0 && !r.sourceErrors))
  add('F3: actionable note suggests passing it via pmids', (r.sourceErrors || []).some((e) => /pass it via pmids/.test(e.note || e.error || '')))
}

// ---- F6: find_related never returns the source article itself ----
{
  const ELINK = JSON.stringify({ linksets: [{ linksetdbs: [{ linkname: 'pubmed_pubmed', links: ['23193287', '111', '222'] }] }] }) // source echoed back as the first link
  const ESUM = JSON.stringify({ result: { uids: ['111', '222'], '111': { pmid: '111', title: 'Neighbor one' }, '222': { pmid: '222', title: 'Neighbor two' } } })
  const { tools } = makeTools((u) => {
    if (u.includes('elink.fcgi')) return { status: 200, body: ELINK }
    if (u.includes('esummary.fcgi')) return { status: 200, body: ESUM }
    return { status: 200, body: '{}' }
  })
  const r = await tools.pubmed_find_related.execute({ pmid: '23193287', relation: 'similar' }, S('f'))
  add('F6: source PMID excluded from its own similar list', !r.ids.includes('23193287'))
  add('F6: count reflects the exclusion (3 links - self = 2)', r.count === 2)
  add('F6: summaries have no self entry', !r.summaries.some((s) => s.pmid === '23193287'))
}

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
const fails = checks.filter(([, ok]) => !ok).length
console.log(fails ? `FEEDBACK TEST FAIL (${fails})` : 'FEEDBACK TEST OK')
process.exit(fails ? 1 : 0)
