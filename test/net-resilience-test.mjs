// net-resilience-test.mjs — P3.8: network retry layer + Europe PMC fallbacks.
// Offline: httpGet mocks fail with network-classified errors, then EBI serves.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(30000) })
const EPM_FIX = { hitCount: 425, resultList: { result: [
  { pmid: '111', id: '111', title: 'Fallback paper one', journalTitle: 'J Fallback', pubYear: '2024', authorString: 'A B', doi: '10.1/x', pmcid: 'PMC1' },
  { pmid: '222', id: '222', title: 'Fallback paper two', journalTitle: 'J Fallback', pubYear: '2023', authorString: 'C D', doi: '10.1/y' },
] } }
const ESPELL_XML = '<eSpellResult><Query>microbiom</Query><CorrectedQuery>microbiome</CorrectedQuery></eSpellResult>'
const netErr = (code) => Object.assign(new Error('fetch failed'), { cause: { code: code || 'ETIMEDOUT' } })

function makeTools(httpGet) {
  const tools = {}
  const sleeps = []
  registerPubmedTools({ get: () => undefined }, {
    defineTool: (o) => o,
    register: (d) => { tools[d.name] = d },
    httpGet,
    sleep: (ms) => { sleeps.push(ms); return Promise.resolve() },
  })
  return { tools, sleeps }
}
const checks = []
const add = (name, ok) => checks.push([name, ok])

// ---- T1: network failure retried with 1s/3s backoff, then succeeds ----
{
  let calls = 0
  const { tools, sleeps } = makeTools(async () => {
    calls++
    if (calls <= 2) throw netErr('ETIMEDOUT')
    return { status: 200, body: ESPELL_XML }
  })
  const r = await tools.pubmed_spell_check.execute({ query: 'microbiom' }, S('nr'))
  console.log('T1 calls=' + calls + ' sleeps=' + JSON.stringify(sleeps) + ' corrected=' + r.corrected)
  add('T1 two network failures then success', calls === 3 && r.corrected === 'microbiome')
  add('T1 backoff steps 1000/3000 applied', sleeps.includes(1000) && sleeps.includes(3000))
}

// ---- T2: exhausted retries → actionable error (dead local proxy hint) ----
{
  process.env.HTTPS_PROXY = 'http://127.0.0.1:9'
  const { tools } = makeTools(async () => { throw netErr('ECONNREFUSED') })
  let msg = ''
  try { await tools.pubmed_spell_check.execute({ query: 'x' }, S('nr')) } catch (e) { msg = String(e.message) }
  delete process.env.HTTPS_PROXY
  console.log('T2 error:', msg.slice(0, 140))
  add('T2 dead local proxy hint present', /local proxy http:\/\/127\.0\.0\.1:9 seems down/.test(msg))
  add('T2 unreachable-host hint present', /host unreachable from this network/.test(msg))
}

// ---- T3: search_articles falls back to Europe PMC (MED) on NCBI outage ----
{
  const urls = []
  const { tools } = makeTools(async (url) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('eutils')) throw netErr('ETIMEDOUT')
    return { status: 200, body: JSON.stringify(EPM_FIX) }
  })
  const r = await tools.pubmed_search_articles.execute({ query: 'metformin cardioprotection' }, S('nr'))
  console.log('T3 viaFallback=' + r.viaFallback + ' count=' + r.count + ' ids=' + r.ids.join(','))
  add('T3 marks europepmc fallback', r.viaFallback === 'europepmc' && /Europe PMC/.test(r.fallbackNote))
  add('T3 ids mapped from EPM results', r.ids.join(',') === '111,222')
  add('T3 summaries mapped (title/journal/year/doi)', r.summaries[0].title === 'Fallback paper one' && r.summaries[0].journal === 'J Fallback' && r.summaries[0].doi === '10.1/x')
  add('T3 retried eutils before falling back', urls.filter((u) => u.includes('eutils')).length === 3 && urls.some((u) => u.includes('ebi.ac.uk')))
}

// ---- T4: find_related cited_by falls back via CITES: ----
{
  const urls = []
  const { tools } = makeTools(async (url) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('eutils')) throw netErr('ECONNRESET')
    return { status: 200, body: JSON.stringify(EPM_FIX) }
  })
  const r = await tools.pubmed_find_related.execute({ pmid: '29355051', relation: 'cited_by' }, S('nr'))
  add('T4 cited_by falls back via CITES:', r.viaFallback === 'europepmc' && r.count === 425 && r.ids.join(',') === '111,222' && urls.some((u) => decodeURIComponent(u).includes('CITES:29355051')))
}

// ---- T5: similar mode has no EPM equivalent → clear error ----
{
  const { tools } = makeTools(async () => { throw netErr('ECONNRESET') })
  let msg = ''
  try { await tools.pubmed_find_related.execute({ pmid: '29355051', relation: 'similar' }, S('nr')) } catch (e) { msg = String(e.message) }
  add('T5 similar mode explains no-EBP-equivalent', /similar.*requires NCBI ELink/.test(msg))
}

// ---- T6: convert_ids falls back per-id (DOI → EPM DOI search) ----
{
  const urls = []
  const { tools } = makeTools(async (url) => {
    const u = String(url)
    urls.push(u)
    if (u.includes('eutils')) throw netErr('ETIMEDOUT')
    return { status: 200, body: JSON.stringify(EPM_FIX) }
  })
  const r = await tools.pubmed_convert_ids.execute({ ids: ['10.1/x'], idtype: 'doi' }, S('nr'))
  const rec = r.records[0]
  add('T6 DOI resolved via EPM fallback', rec.status === 'ok' && rec.pmid === '111' && rec.pmcid === 'PMC1' && r.viaFallback === 'europepmc')
}

// ---- T7: HTTP 4xx is a real answer — no retry, no fallback ----
{
  let calls = 0
  const { tools } = makeTools(async () => { calls++; throw new Error('HTTP 400 from eutils: bad request') })
  let msg = ''
  try { await tools.pubmed_search_articles.execute({ query: 'x' }, S('nr')) } catch (e) { msg = String(e.message) }
  add('T7 HTTP 400 not retried (1 call)', calls === 1)
  add('T7 HTTP 400 message preserved', msg.startsWith('HTTP 400'))
}

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks.some(([, ok]) => !ok)) { console.log('NET RESILIENCE FAIL'); process.exit(1) }
console.log('NET RESILIENCE TEST OK')
