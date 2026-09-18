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

// ---- F3: pmcids param receiving a PMID AUTO-CONVERTS and resolves ----
{
  const { tools } = makeTools((u) => {
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: JSON.stringify({ resultList: { result: [] } }) } // PMCID unknown
    if (u.includes('elink.fcgi')) return { status: 200, body: JSON.stringify({ linksets: [{ linksetdbs: [{ linkname: 'pubmed_pmc', links: ['10625320'] }] }] }) } // as PMID it HAS a PMCID
    if (u.includes('esummary.fcgi')) return { status: 200, body: JSON.stringify({ result: { '37928369': { articleids: [{ idtype: 'doi', value: '10.2147/NSS.S424756' }] } } }) }
    return { status: 200, body: '{}' }
  })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ pmcid: '37928369' }, S('f')) // a bare PMID passed as pmcid
  add('F3: bare PMID passed as pmcid auto-converts (input resolved)', r.input.pmid === '37928369' && r.input.pmcid === 'PMC10625320')
  add('F3: conversion note present (treated as pmid)', r.converted != null && r.converted.treated === 'pmid:37928369')
}

// ---- F3b: genuinely unknown number → actionable note (conversion also failed) ----
{
  const { tools } = makeTools((u) => {
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: JSON.stringify({ resultList: { result: [] } }) }
    if (u.includes('elink.fcgi')) return { status: 200, body: JSON.stringify({ linksets: [] }) } // no PMCID either
    return { status: 200, body: '{}' }
  })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ pmcid: '99999999' }, S('f'))
  if (process.env.DEBUG_F3B) console.log('F3b DEBUG:', JSON.stringify(r, null, 1).slice(0, 800))
  add('F3b: unresolvable number → actionable note (not a valid PMCID)', (r.sourceErrors || []).some((e) => /valid PMC ID/.test(e.note || e.error || '')))
  add('F3b: no misleading OA=false', !(r.isOpenAccess === false && r.locationCount === 0 && !r.sourceErrors))
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

// ---- A2/A3/C (F2 round 3): semantic gate, mermaid bring-in budget, kill switch ----
{
  // The F2 debris article: fragments like "microbial communities are" must not
  // become keyword nodes; the legit relation ("microbiota modulates
  // inflammation") survives because both endpoints are article keywords.
  const article = {
    pmid: '1',
    title: 'Microbiota-derived indoles alleviate intestinal inflammation',
    abstractText: 'They share similar features with the host. Microbial communities are shaped by diet. Microbiota modulates inflammation. Lactobacillus produces indole-3-lactic acid. The intestinal tract can chronically activate the immune system.',
  }
  const { tools } = makeTools(() => ({ status: 200, body: '{}' }))
  await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('f'))
  await tools.pubmed_graph_add.execute({ articles: [article] }, S('f'))
  const g = await tools.pubmed_graph_get.execute({ scope: 'session', format: 'json' }, S('f'))
  const labels = g.session.nodes.filter((n) => n.type === 'keyword').map((n) => n.label)
  const count0 = g.session.nodes.filter((n) => n.type === 'keyword' && !n.count)
  add('A2: no count-0 debris keyword endpoints (all endpoints are article keywords)', count0.length === 0)
  add('A2: the valid relation survives (microbiota modulates inflammation)', g.session.edges.some((e) => e.kind === 'relation' && e.source.includes('microbiota') && e.target.includes('inflammation')))
  // A3: mermaid bring-in skips count-0 keyword endpoints (test with the gate OFF
  // so count-0 endpoints exist, then check mermaid excludes them).
  const mk = (extraDeps) => { const t = {}; registerPubmedTools({ get: () => undefined }, { defineTool: (o) => o, register: (d) => { t[d.name] = d }, httpGet: async () => ({ status: 200, body: '{}' }), sleep: () => Promise.resolve(), ...extraDeps }); return t }
  const tOff = mk({ relationEndpointRequireKeyword: false })
  await tOff.pubmed_graph_reset.execute({ scope: 'session' }, S('f'))
  await tOff.pubmed_graph_add.execute({ articles: [article] }, S('f'))
  const gOff = await tOff.pubmed_graph_get.execute({ scope: 'session', format: 'mermaid' }, S('f'))
  const mmd = gOff.mermaid.session || ''
  const offNodes = gOff.session ? (gOff.session.nodes || []) : []
  void offNodes
  add('A3: mermaid does not bring in count-0 keyword endpoints', !/("they share similar"|"share similar"|will share)/.test(mmd))
  // C: HEURISTIC_RELATIONS:false → zero relation edges (pure curated graph)
  const tC = mk({ heuristicRelations: false })
  await tC.pubmed_graph_reset.execute({ scope: 'session' }, S('f'))
  await tC.pubmed_graph_add.execute({ articles: [article] }, S('f'))
  const gC = await tC.pubmed_graph_get.execute({ scope: 'session', format: 'json' }, S('f'))
  add('C: HEURISTIC_RELATIONS:false → zero relation edges', gC.session.edges.every((e) => e.kind !== 'relation'))
  add('C: keyword nodes still built (MeSH/token layer unaffected)', gC.session.nodes.some((n) => n.type === 'keyword'))
}

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
const fails = checks.filter(([, ok]) => !ok).length
console.log(fails ? `FEEDBACK TEST FAIL (${fails})` : 'FEEDBACK TEST OK')
process.exit(fails ? 1 : 0)
