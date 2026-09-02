// e-items-test.mjs — E1（npmmirror 脚本结构）/ E2（fetch_fulltext 切片）/
// E3+E4（统一搜索去重合并）的离线回归测试。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()

const checks = []
const add = (name, ok) => checks.push([name, ok])
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(30000) })
const netErr = (code) => Object.assign(new Error('fetch failed'), { cause: { code: code || 'ETIMEDOUT' } })

const MED = 'PMID- 111\nTI  - t\n'
const JATS = `<?xml version="1.0"?><article><front><article-meta><title-group><article-title>Meta Title Paper</article-title></title-group><abstract><p>Abstract text about metformin.</p></abstract></article-meta></front><body><sec><title>Intro</title><p>Paragraph one about AMPK activation pathways.</p><p>Paragraph two about clinical outcomes.</p></sec></body></article>`

function makeTools(httpGet) {
  const tools = {}
  const urls = []
  const sleeps = []
  registerPubmedTools({ get: () => undefined }, {
    defineTool: (o) => o,
    register: (d) => { tools[d.name] = d },
    httpGet: async (url) => { urls.push(String(url)); return httpGet(String(url)) },
    httpPost: async (url, formBody) => { urls.push('POST ' + String(url)); return { status: 200, body: '' } },
    sleep: (ms) => { sleeps.push(ms); return Promise.resolve() },
  })
  return { tools, urls, sleeps }
}

// ---- E4: titleKey identity semantics (via the tool, observable through dedup) ----
// ---- E3: merge + rank + perSource resilience ----
{
  // PubMed rows: two papers (111 exact, 222 pubmed-only). EPM rows: 111 (same pmid,
  // has citedByCount + abstract), 333 epm-only, and 444 with the SAME title as 222
  // but no ids (title-key merge; one uses composed é, the other decomposed).
  const esearch = JSON.stringify({ esearchresult: { idlist: ['111', '222'], count: '2' } })
  const esummary = JSON.stringify({
    result: {
      uids: ['111', '222'],
      '111': { pmid: '111', title: 'Metformin and AMPK activation in liver', authors: [{ name: 'A Author' }], fulljournalname: 'J Metab', pubdate: '2024 Jan', articleids: [{ idtype: 'doi', value: '10.1/aaa' }] },
      '222': { pmid: '222', title: 'Café studies in mice', authors: [{ name: 'B Author' }], fulljournalname: 'J Cafe', pubdate: '2023 Mar', articleids: [] },
    },
  })
  const epm = JSON.stringify({
    hitCount: 500,
    resultList: { result: [
      { id: 'EPM1', source: 'MED', pmid: '111', title: 'Metformin and AMPK activation in liver', authorString: 'A Author', journalTitle: 'J Metab', pubYear: '2024', citedByCount: 87, abstractSnippet: 'AMPK abstract.' },
      { id: 'EPM2', source: 'PPR', title: 'Preprint only record', authorString: 'C Author', pubYear: '2025', citedByCount: 2 },
      { id: 'EPM3', source: 'MED', title: 'Cafe\u0301 studies in mice', authorString: 'B Author', pubYear: '2023' },
    ] },
  })
  const { tools } = makeTools((u) => {
    if (u.includes('esearch.fcgi')) return { status: 200, body: esearch }
    if (u.includes('esummary.fcgi')) return { status: 200, body: esummary }
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: epm }
    return { status: 200, body: MED }
  })
  const r = await tools.pubmed_search_papers.execute({ query: 'metformin', maxResultsPerSource: 10 }, S('e'))
  add('E3 total = 3 unique after merge (5 records, 2 overlaps)', r.total === 3)
  const first = r.papers[0]
  add('E3 multi-platform hit ranks first', first?.pmid === '111' && Array.isArray(first.foundIn) && first.foundIn.includes('pubmed') && first.foundIn.includes('europepmc'))
  add('E3 merged record keeps EPM citedByCount + PubMed authors', first.citedByCount === 87 && Array.isArray(first.authors) && first.authors[0] === 'A Author')
  const cafe = r.papers.find((p) => (p.title || '').toLowerCase().includes('caf'))
  add('E4 NFKC composed/decomposed title merges (Café = Cafe+combining)', cafe != null && Array.isArray(cafe.foundIn) && cafe.foundIn.length === 2)
  const preprint = r.papers.find((p) => (p.title || '').includes('Preprint only'))
  add('E3 single-source record keeps foundIn=[europepmc]', preprint != null && preprint.foundIn.length === 1)
  add('E3 perSource reports both sources OK', r.perSource.length === 2 && r.perSource.every((p) => !p.error))
  const ranksMulti = r.papers.filter((p) => p.foundIn.length === 2)
  add('E3 ranking: both multi-platform hits precede single-source ones', r.papers.indexOf(ranksMulti[0]) === 0 && r.papers.indexOf(ranksMulti[1]) === 1)
}
{
  // perSource resilience: PubMed side throws (network), EPM still serves.
  const epm = JSON.stringify({ hitCount: 3, resultList: { result: [{ id: 'EPM9', source: 'MED', pmid: '999', title: 'Survived the outage', authorString: 'D Author', pubYear: '2024' }] } })
  const { tools } = makeTools((u) => {
    if (u.includes('esearch.fcgi') || u.includes('esummary.fcgi')) throw netErr('ECONNRESET')
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: epm }
    return { status: 200, body: MED }
  })
  const r = await tools.pubmed_search_papers.execute({ query: 'anything' }, S('e'))
  const pub = r.perSource.find((p) => p.source === 'pubmed')
  add('E3 one platform failing never kills the call (perSource.error)', r.total === 1 && pub?.error != null && r.papers[0].title === 'Survived the outage')
}
{
  // E4 short-title guard: <12 code points never merges by title.
  const esearch = JSON.stringify({ esearchresult: { idlist: ['555'], count: '1' } })
  const esummary = JSON.stringify({ result: { uids: ['555'], '555': { pmid: '555', title: 'Overview', authors: [{ name: 'X' }], fulljournalname: 'J', pubdate: '2020', articleids: [] } } })
  const epm = JSON.stringify({ hitCount: 1, resultList: { result: [{ id: 'E1', source: 'MED', title: 'Overview', authorString: 'Y', pubYear: '2021' }] } })
  const { tools } = makeTools((u) => {
    if (u.includes('esearch.fcgi')) return { status: 200, body: esearch }
    if (u.includes('esummary.fcgi')) return { status: 200, body: esummary }
    if (u.includes('europepmc') || u.includes('ebi.ac.uk')) return { status: 200, body: epm }
    return { status: 200, body: MED }
  })
  const r = await tools.pubmed_search_papers.execute({ query: 'q' }, S('e'))
  add('E4 titles shorter than 12 code points do NOT merge (wrong merge is worse than a duplicate)', r.total === 2)
}
{
  // E2: fetch_fulltext slicing — page through a body with maxCharacters/offset.
  const { tools } = makeTools((u) => {
    if (u.includes('efetch.fcgi')) return { status: 200, body: JATS }
    return { status: 200, body: MED }
  })
  const page1 = await tools.pubmed_fetch_fulltext.execute({ pmcids: ['PMC1'], maxCharacters: 100 }, S('e'))
  const a1 = page1.articles[0]
  if (process.env.DEBUG_E2) console.log('E2 DEBUG a1:', JSON.stringify(a1, null, 1).slice(0, 500))
  add('E2 page 1 returns nextOffset when content remains', a1.source === 'pmc' && a1.truncated === true && a1.nextOffset === 100 && a1.totalLength > 100)
  const page2 = await tools.pubmed_fetch_fulltext.execute({ pmcids: ['PMC1'], maxCharacters: 100, offset: a1.nextOffset }, S('e'))
  const a2 = page2.articles[0]
  add('E2 page 2 continues without overlap', a2.offset === 100 && a2.body.length > 0 && a2.body !== a1.body)
  const last = await tools.pubmed_fetch_fulltext.execute({ pmcids: ['PMC1'], maxCharacters: 100000, offset: 0 }, S('e'))
  const a3 = last.articles[0]
  add('E2 single big page reaches the end (no nextOffset, not truncated)', a3.nextOffset === undefined && a3.truncated === false && a3.totalLength === a3.body.length)
  // E1: the mirror-sync script exists, is wired into release.yml, and exits cleanly
  // (live execution asserted separately).
  const wf = readFileSync(fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url)), 'utf8')
  const script = readFileSync(fileURLToPath(new URL('../scripts/sync-mirror.mjs', import.meta.url)), 'utf8')
  add('E1 sync-mirror wired into release.yml publish step', wf.includes('node scripts/sync-mirror.mjs') && script.includes('registry.npmmirror.com'))
}

for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
const fails = checks.filter(([, ok]) => !ok).length
console.log(fails ? `E-ITEMS FAIL (${fails})` : 'E-ITEMS OK')
process.exit(fails ? 1 : 0)
