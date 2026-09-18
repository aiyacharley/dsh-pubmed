// pdf-oa-test.mjs — v0.4.2: pubmed_fetch_pdf_oa offline tests.
// Covers the three-source OA aggregation (Unpaywall + Europe PMC fullTextUrlList
// + OpenAlex), cross-source de-duplication, best-PDF selection, DOI/PMID/PMCID
// input handling, mutual-exclusion + validation errors, the optional download
// step, and the no-OA case — all with a mocked httpGet, zero network.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()

const checks = []
const add = (name, ok) => checks.push([name, ok])
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(30000) })

const DOI = '10.1038/nature12373'
const PDF = 'https://www.nature.com/articles/nature12373.pdf'

// Unpaywall: two OA locations, best is the publisher PDF.
const UNPAYWALL = JSON.stringify({
  doi: DOI, is_oa: true, oa_status: 'bronze', journal_name: 'Nature', publisher: 'Springer Nature', title: 'Nanometre-scale thermometry', year: 2013,
  oa_locations: [
    { url: 'https://dash.harvard.edu/bitstream/1/x', url_for_pdf: 'https://dash.harvard.edu/bitstream/1/x.pdf', url_for_landing_page: 'https://dash.harvard.edu/handle/1/x', host_type: 'repository', version: 'acceptedVersion', license: 'cc-by', is_best: false },
    { url: PDF, url_for_pdf: PDF, url_for_landing_page: 'https://www.nature.com/articles/nature12373', host_type: 'publisher', version: 'publishedVersion', license: null, is_best: true },
  ],
})
// Europe PMC: fullTextUrlList with a render PDF + a subscription DOI link.
const EPMC_CORE = JSON.stringify({
  resultList: { result: [{
    pmid: '23903754', pmcid: 'PMC4221854', isOpenAccess: 'Y', inEPMC: 'Y', inPMC: 'Y',
    title: 'Nanometre-scale thermometry', journalTitle: 'Nature', pubYear: '2013',
    fullTextUrlList: { fullTextUrl: [
      { documentStyle: 'doi', availability: 'Subscription required', url: 'https://doi.org/' + DOI },
      { documentStyle: 'html', availability: 'Free', url: 'https://europepmc.org/articles/PMC4221854' },
      { documentStyle: 'pdf', availability: 'Free', url: 'https://europepmc.org/articles/PMC4221854?pdf=render' },
    ] },
  }] },
})
// OpenAlex: best_oa_location points at the SAME publisher PDF (dedup case).
const OPENALEX = JSON.stringify({
  id: 'https://openalex.org/W1', doi: 'https://doi.org/' + DOI, title: 'Nanometre-scale thermometry', publication_year: 2013,
  open_access: { is_oa: true, oa_status: 'bronze', oa_url: PDF },
  best_oa_location: { pdf_url: PDF, landing_page_url: 'https://www.nature.com/articles/nature12373', license: null, version: 'publishedVersion', source: { type: 'journal' } },
  locations: [{ pdf_url: PDF, landing_page_url: 'https://www.nature.com/articles/nature12373', source: { type: 'journal' } }],
})
// NCBI id-conversion mocks (used when input is pmid/pmcid).
const ELINK_PMID_TO_PMC = JSON.stringify({ linksets: [{ linksetdbs: [{ linkname: 'pubmed_pmc', links: ['4221854'] }] }] })
const ESUMMARY_DOI = JSON.stringify({ result: { '23903754': { articleids: [{ idtype: 'doi', value: DOI }] } } })

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
function defaultMock(u) {
  if (u.includes('api.unpaywall.org')) return { status: 200, body: UNPAYWALL }
  if (u.includes('api.openalex.org')) return { status: 200, body: OPENALEX }
  if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: EPMC_CORE }
  if (u.includes('elink.fcgi')) return { status: 200, body: ELINK_PMID_TO_PMC }
  if (u.includes('esummary.fcgi')) return { status: 200, body: ESUMMARY_DOI }
  return { status: 200, body: '{}' }
}

// ---- 1) DOI input: three sources aggregated, cross-source dedup, best PDF ----
{
  const { tools } = makeTools(defaultMock)
  const r = await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI }, S('p'))
  add('DOI input: open access detected', r.isOpenAccess === true && r.oaStatus === 'bronze')
  add('DOI input: locations from all three sources', ['unpaywall', 'europepmc', 'openalex'].every((s) => r.locations.some((l) => l.source === s || (Array.isArray(l.alsoIn) && l.alsoIn.includes(s)))))
  add('DOI input: publisher PDF de-duplicated across unpaywall+openalex', r.locations.filter((l) => (l.pdfUrl || '') === PDF).length === 1)
  const dup = r.locations.find((l) => (l.pdfUrl || '') === PDF)
  add('DOI input: deduped entry records both sources', Array.isArray(dup.alsoIn) && dup.alsoIn.includes('unpaywall') && dup.alsoIn.includes('openalex'))
  add('DOI input: bestPdfUrl is the publisher PDF', r.bestPdfUrl === PDF)
  add('DOI input: PDF links rank before landing pages', r.locations[0].pdfUrl != null)
  add('DOI input: EPMC render PDF captured', r.locations.some((l) => (l.pdfUrl || '').includes('europepmc.org') && l.pdfUrl.includes('pdf=render')))
  add('DOI input: license/version carried through', r.locations.some((l) => l.version === 'acceptedVersion' && l.license === 'cc-by'))
  add('DOI input: subscription-only DOI link not counted as PDF', !r.locations.some((l) => (l.url || '').includes('doi.org') && l.pdfUrl))
}

// ---- 2) pmid input: resolved to DOI/PMCID then aggregated ----
{
  const { tools, urls } = makeTools(defaultMock)
  const r = await tools.pubmed_fetch_pdf_oa.execute({ pmid: '23903754' }, S('p'))
  add('pmid input: resolved pmid+pmcid in output', r.input.pmid === '23903754' && r.input.pmcid === 'PMC4221854')
  add('pmid input: DOI resolved so Unpaywall/OpenAlex ran', r.input.doi === DOI && r.locations.some((l) => l.source === 'unpaywall'))
  add('pmid input: used elink + esummary for resolution', urls.some((u) => u.includes('elink.fcgi')) && urls.some((u) => u.includes('esummary.fcgi')))
  add('pmid input: bestPdfUrl found', r.bestPdfUrl === PDF)
}

// ---- 3) pmcid input ----
{
  const { tools } = makeTools(defaultMock)
  const r = await tools.pubmed_fetch_pdf_oa.execute({ pmcid: '4221854' }, S('p'))
  add('pmcid input: normalized to PMC-prefixed form', r.input.pmcid === 'PMC4221854')
}

// ---- 4) input validation ----
{
  const { tools } = makeTools(defaultMock)
  let m1 = ''
  try { await tools.pubmed_fetch_pdf_oa.execute({}, S('p')) } catch (e) { m1 = String(e.message) }
  add('no identifier throws', /Provide one of doi \/ pmid \/ pmcid/.test(m1))
  let m2 = ''
  try { await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI, pmid: '23903754' }, S('p')) } catch (e) { m2 = String(e.message) }
  add('two identifiers throws mutual-exclusion', /mutually exclusive/.test(m2))
  let m3 = ''
  try { await tools.pubmed_fetch_pdf_oa.execute({ doi: 'not-a-doi' }, S('p')) } catch (e) { m3 = String(e.message) }
  add('malformed DOI throws', /Not a valid DOI/.test(m3))
  let m4 = ''
  try { await tools.pubmed_fetch_pdf_oa.execute({ pmcid: 'abc' }, S('p')) } catch (e) { m4 = String(e.message) }
  add('malformed PMCID throws', /Not a valid PMC ID/.test(m4))
}

// ---- 5) no OA copy ----
{
  const closed = JSON.stringify({ doi: DOI, is_oa: false, oa_status: 'closed', oa_locations: [] })
  const { tools } = makeTools((u) => {
    if (u.includes('api.unpaywall.org')) return { status: 200, body: closed }
    if (u.includes('api.openalex.org')) return { status: 200, body: JSON.stringify({ open_access: { is_oa: false }, best_oa_location: null, locations: [] }) }
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: JSON.stringify({ resultList: { result: [{ isOpenAccess: 'N', fullTextUrlList: { fullTextUrl: [{ documentStyle: 'doi', availability: 'Subscription required', url: 'https://doi.org/' + DOI }] } }] } }) }
    return { status: 200, body: '{}' }
  })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI }, S('p'))
  add('closed article: isOpenAccess false, no best PDF', r.isOpenAccess === false && r.bestPdfUrl === null)
  add('closed article: subscription link still listed (not a PDF)', r.locations.length === 1 && r.locations[0].pdfUrl === null)
}

// ---- 6) download step (mocked) ----
{
  let dlUrl = ''
  const { tools } = makeTools(defaultMock, { downloadToFile: async (url) => { dlUrl = url; return { savedPath: 'C:/tmp/paper.pdf', bytes: 12345, contentType: 'application/pdf' } } })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI, download: true }, S('p'))
  add('download: called with the best PDF URL', dlUrl === PDF)
  add('download: savedPath + bytes reported', r.download.ok === true && r.download.savedPath === 'C:/tmp/paper.pdf' && r.download.bytes === 12345)
  const { tools: t2 } = makeTools(defaultMock) // no downloadToFile injected
  const r2 = await t2.pubmed_fetch_pdf_oa.execute({ doi: DOI, download: true }, S('p'))
  add('download: unavailable without the bundle capability (graceful)', r2.download.ok === false && /download unavailable/.test(r2.download.error))
  // No PDF anywhere: every source reports a landing page / subscription only.
  const noPdfMock = (u) => {
    if (u.includes('api.unpaywall.org')) return { status: 200, body: JSON.stringify({ is_oa: false, oa_status: 'closed', oa_locations: [] }) }
    if (u.includes('api.openalex.org')) return { status: 200, body: JSON.stringify({ open_access: { is_oa: false }, best_oa_location: null, locations: [] }) }
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: JSON.stringify({ resultList: { result: [{ isOpenAccess: 'N', fullTextUrlList: { fullTextUrl: [{ documentStyle: 'html', availability: 'Subscription required', url: 'https://example.org/landing' }] } }] } }) }
    return { status: 200, body: '{}' }
  }
  const { tools: t3 } = makeTools(noPdfMock, { downloadToFile: async () => ({ savedPath: 'x', bytes: 1 }) })
  const r3 = await t3.pubmed_fetch_pdf_oa.execute({ doi: DOI, download: true }, S('p'))
  add('download: no PDF URL → clear error, no download attempt', r3.download.ok === false && /no direct PDF URL/.test(r3.download.error))
}
// ---- 6b) download falls through blocked links to the next candidate ----
{
  const seen = []
  const { tools } = makeTools(defaultMock, {
    downloadToFile: async (url) => {
      seen.push(url)
      if (url === PDF) throw new Error('not a PDF — the server returned an HTML page (consent wall, paywall or bot challenge)')
      return { savedPath: 'C:/tmp/fallback.pdf', bytes: 999, contentType: 'application/pdf' }
    },
  })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI, download: true }, S('p'))
  add('download: blocked publisher link falls through to the next PDF', r.download.ok === true && r.download.savedPath === 'C:/tmp/fallback.pdf')
  add('download: fallback recorded the blocked attempt', Array.isArray(r.download.attempts) && r.download.attempts.length === 1 && r.download.attempts[0].url === PDF)
  add('download: tried more than one candidate', seen.length >= 2)
}
// ---- 6c) all candidates blocked → aggregated error ----
{
  const { tools } = makeTools(defaultMock, { downloadToFile: async () => { throw new Error('HTTP 403') } })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI, download: true }, S('p'))
  add('download: all links blocked → error lists every attempt', r.download.ok === false && /all \d+ PDF link\(s\) failed/.test(r.download.error) && r.download.attempts.length >= 2)
  add('download: all-blocked error is actionable (points at links / fetch_fulltext)', /consent wall or bot check/.test(r.download.error) && /pubmed_fetch_fulltext/.test(r.download.error))
}

// ---- 6d) BATCH form: a search hit list → OA link list in ONE call ----
{
  // Three pmids; the middle one is closed. All three must be reported.
  const closedDoi = '10.2337/db07-1098'
  const { tools } = makeTools((u) => {
    // Unpaywall / OpenAlex / EPMC all key off the DOI in the query string.
    const isClosed = u.includes(encodeURIComponent(closedDoi)) || u.includes(closedDoi)
    if (u.includes('api.unpaywall.org')) {
      return isClosed
        ? { status: 200, body: JSON.stringify({ is_oa: false, oa_status: 'closed', oa_locations: [] }) }
        : { status: 200, body: UNPAYWALL }
    }
    if (u.includes('api.openalex.org')) {
      return isClosed
        ? { status: 200, body: JSON.stringify({ open_access: { is_oa: false }, best_oa_location: null, locations: [] }) }
        : { status: 200, body: OPENALEX }
    }
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) {
      // A closed DOI's EPMC record reports isOpenAccess=N and no free PDF.
      return isClosed
        ? { status: 200, body: JSON.stringify({ resultList: { result: [{ isOpenAccess: 'N', fullTextUrlList: { fullTextUrl: [{ documentStyle: 'doi', availability: 'Subscription required', url: 'https://doi.org/' + closedDoi }] } }] } }) }
        : { status: 200, body: EPMC_CORE }
    }
    if (u.includes('esummary.fcgi')) {
      // pmid 111 → open DOI; 222 → closed DOI; 333 → no DOI at all
      const body = u.includes('333')
        ? JSON.stringify({ result: { '333': { articleids: [] } } })
        : u.includes('222')
          ? JSON.stringify({ result: { '222': { articleids: [{ idtype: 'doi', value: closedDoi }] } } })
          : JSON.stringify({ result: { '111': { articleids: [{ idtype: 'doi', value: DOI }] } } })
      return { status: 200, body }
    }
    if (u.includes('elink.fcgi')) return { status: 200, body: ELINK_PMID_TO_PMC }
    return { status: 200, body: '{}' }
  })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ pmids: ['111', '222', '333'] }, S('p'))
  add('batch: marked batch + reports all 3 ids', r.batch === true && r.requested === 3 && r.results.length === 3)
  add('batch: counts OA + downloadable', r.openAccessCount >= 1 && r.downloadableCount >= 1)
  add('batch: every result carries id + idType', r.results.every((x) => x.id && x.idType === 'pmid'))
  add('batch: closed id reported as not-OA (not dropped)', r.results.some((x) => x.input.pmid === '222' && x.isOpenAccess === false))
  add('batch: open id has a best PDF', r.results.some((x) => x.bestPdfUrl === PDF))
}
// ---- 6e) batch download: one savedPath per downloadable id ----
{
  const closedDoi = '10.2337/db07-1098'
  // NOTE: the plugin URL-encodes DOIs into the request URL (correct), so the
  // mock must match the ENCODED form — matching the raw DOI silently misses.
  const encClosed = encodeURIComponent(closedDoi)
  const { tools } = makeTools((u) => {
    const isClosed = u.includes(encClosed) || u.includes(closedDoi)
    if (u.includes('api.unpaywall.org')) return isClosed ? { status: 200, body: JSON.stringify({ is_oa: false, oa_locations: [] }) } : { status: 200, body: UNPAYWALL }
    if (u.includes('api.openalex.org')) return isClosed ? { status: 200, body: JSON.stringify({ open_access: { is_oa: false }, best_oa_location: null, locations: [] }) } : { status: 200, body: OPENALEX }
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return isClosed ? { status: 200, body: JSON.stringify({ resultList: { result: [] } }) } : { status: 200, body: EPMC_CORE }
    return { status: 200, body: '{}' }
  }, { downloadToFile: async (url) => ({ savedPath: 'C:/tmp/' + url.split('/').pop(), bytes: 10, contentType: 'application/pdf' }) })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ dois: [DOI, closedDoi], download: true }, S('p'))
  add('batch download: results carry per-id download outcomes', r.results.every((x) => x.download != null))
  add('batch download: open one saved, closed one reports an error', r.results.some((x) => x.download.ok === true) && r.results.some((x) => x.download.ok === false))
}
// ---- 6f) batch input validation ----
{
  const { tools } = makeTools(defaultMock)
  let m1 = ''
  try { await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI, pmids: ['111'] }, S('p')) } catch (e) { m1 = String(e.message) }
  add('mixed single + batch form rejected', /either the single-id form.*or the batch form/.test(m1))
  let m2 = ''
  try { await tools.pubmed_fetch_pdf_oa.execute({ pmids: ['111'], dois: [DOI] }, S('p')) } catch (e) { m2 = String(e.message) }
  add('two batch lists rejected', /mutually exclusive/.test(m2))
  const many = await tools.pubmed_fetch_pdf_oa.execute({ pmids: Array.from({ length: 14 }, (_, i) => String(100 + i)) }, S('p'))
  add('batch capped at 10 with truncation reported', many.requested === 10 && many.truncated === 14)
}

// ---- 6g) unified search surfaces OA flags (change B) ----
{
  const esearch = JSON.stringify({ esearchresult: { idlist: [], count: '0' } })
  const epm = JSON.stringify({ hitCount: 1, resultList: { result: [{ id: 'E1', source: 'MED', title: 'OA via EPMC', pubYear: '2024', doi: '10.1/oa', isOpenAccess: 'Y', inPMC: 'Y' }] } })
  const oa = JSON.stringify({ meta: { count: 1 }, results: [
    { id: 'https://openalex.org/W1', title: 'OA via OpenAlex', publication_year: 2023, doi: 'https://doi.org/10.1/oa2', ids: {}, open_access: { is_oa: true, oa_status: 'gold', oa_url: 'https://example.org/a.pdf' }, best_oa_location: { pdf_url: 'https://example.org/a.pdf', landing_page_url: 'https://example.org/a' } },
    { id: 'https://openalex.org/W2', title: 'Closed paper', publication_year: 2023, doi: 'https://doi.org/10.1/closed', ids: {}, open_access: { is_oa: false }, best_oa_location: null },
  ] })
  const { tools } = makeTools((u) => {
    if (u.includes('esearch.fcgi')) return { status: 200, body: esearch }
    if (u.includes('api.openalex.org')) return { status: 200, body: oa }
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: epm }
    return { status: 200, body: '{}' }
  })
  const r = await tools.pubmed_search_papers.execute({ query: 'x' }, S('p'))
  add('search: OpenAlex hit carries isOpenAccess + oaUrl', r.papers.some((p) => p.isOpenAccess === true && p.oaUrl === 'https://example.org/a.pdf' && p.oaStatus === 'gold'))
  add('search: EPMC hit carries isOpenAccess + inPmc', r.papers.some((p) => p.isOpenAccess === true && p.inPmc === true))
  add('search: closed paper has no OA flag', r.papers.some((p) => p.title === 'Closed paper' && p.isOpenAccess === undefined))
  add('search: OA fields survive the merge (merged record keeps OA)', r.papers.some((p) => p.isOpenAccess === true && Array.isArray(p.foundIn)))
}

// ---- 7) source resilience: one source down, others still serve ----
{
  const { tools } = makeTools((u) => {
    if (u.includes('api.unpaywall.org')) throw new Error('HTTP 503 from unpaywall')
    return defaultMock(u)
  })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI }, S('p'))
  add('one source failing never kills the call (sourceErrors reported)', r.sourceErrors != null && r.sourceErrors.some((e) => e.source === 'unpaywall'))
  add('one source failing: other sources still return locations', r.locations.some((l) => l.source === 'europepmc'))
}

// ---- 8) Unpaywall 404/422 are real answers, not failures ----
{
  const { tools } = makeTools((u) => {
    if (u.includes('api.unpaywall.org')) throw new Error('HTTP 404 from api.unpaywall.org: not found')
    return defaultMock(u)
  })
  const r = await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI }, S('p'))
  add('unpaywall 404 treated as no-OA note (not an error)', !(r.sourceErrors || []).some((e) => e.source === 'unpaywall' && e.error))
}

// ---- 9) unpaywallEmail config reaches the URL ----
{
  const { tools, urls } = makeTools(defaultMock, { unpaywallEmail: 'me@example.org' })
  await tools.pubmed_fetch_pdf_oa.execute({ doi: DOI }, S('p'))
  add('UNPAYWALL_EMAIL override reaches the request URL', urls.some((u) => u.includes('api.unpaywall.org') && u.includes(encodeURIComponent('me@example.org'))))
}

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
const fails = checks.filter(([, ok]) => !ok).length
console.log(fails ? `PDF-OA TEST FAIL (${fails})` : 'PDF-OA TEST OK')
process.exit(fails ? 1 : 0)
