// pubmed-core.js — shared core of the dsh-pubmed plugin.
//
// Plain JavaScript (no import/export, no TypeScript) so the SAME file can be
// evaluated in two entry points:
//   - the npm bundle plugin (lib/index.js) — provides a `fetch`-based httpGet
//     and `ctx.tools.register`;
//   - a session dynamic plugin (cordis_define) — provides a curl-subprocess
//     httpGet and `harness.registerTool`.
//
// It ports the capabilities of @cyanheads/pubmed-mcp-server
// (https://github.com/cyanheads/pubmed-mcp-server, Apache-2.0) into 11 DSH
// model tools that talk directly to NCBI E-utilities and Europe PMC REST.
//
// `deps` contract:
//   {
//     defineTool(opts) -> ToolDefinition
//     register(definition) -> disposer       // register a tool
//     httpGet(url, signal, timeoutMs?) -> { status, body }   // must reject on non-2xx
//     sleep(ms) -> Promise<void>
//   }

function registerPubmedTools(ctx, deps) {
  'use strict'

  const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
  const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest'
  const TOOL = 'dsh-pubmed'
  // NCBI asks API callers to send a contact email with requests (esp. the PMC ID
  // Converter, which 403s without one) and to identify themselves.
  const NCBI_EMAIL = 'dsh-pubmed-plugin@users.noreply.github.com'

  const { defineTool, httpGet, sleep } = deps
  // Optional NCBI API key (raises the rate limit to 10 req/s). Read from the
  // environment by the bundle entry and injected here; never hardcoded.
  const apiKey = deps.apiKey || ''
  // Optional AUTO_GRAPH mode: when enabled, every pubmed_fetch_articles call
  // automatically merges its results into the current session knowledge graph
  // (no explicit pubmed_graph_add needed).
  const autoGraph = !!deps.autoGraph
  // Adaptive NCBI pacing: with an API key NCBI allows 10 req/s, so use a
  // ~120 ms gap (~8 req/s, safely under the limit); without a key keep the
  // conservative ~350 ms gap (~2.8 req/s, under the 3 req/s limit).
  const NCBI_GAP_MS = apiKey ? 120 : 350

  // ---------------------------------------------------------------- transport
  function qs(params) {
    const parts = []
    for (const k of Object.keys(params)) {
      const v = params[k]
      if (v === undefined || v === null || v === '') continue
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
    }
    return parts.join('&')
  }

  // Shared NCBI rate limiter: serializes every E-utilities request with a gap
  // (NCBI_GAP_MS) so parallel tool calls cannot trip NCBI's rate limit (which
  // without an API key returns HTTP 429 and silently empties eSummary steps).
  // Mirrors the upstream server's global request queue.
  let ncbiChain = Promise.resolve()
  let ncbiLast = 0
  function ncbiScheduled(fn) {
    const run = ncbiChain.then(async () => {
      const now = Date.now()
      const wait = Math.max(0, ncbiLast + NCBI_GAP_MS - now)
      ncbiLast = Math.max(now, ncbiLast + NCBI_GAP_MS)
      if (wait > 0) await sleep(wait)
      return fn()
    })
    ncbiChain = run.then(() => {}, () => {})
    return run
  }

  // Dedicated PubTator3 pacing: pubtator3-api allows at most 3 req/s REGARDLESS
  // of any NCBI API key, so it must NOT share the NCBI queue (which speeds up to
  // a ~120 ms gap when an API key is configured and would exceed the PubTator
  // limit). Fixed ~350 ms gap (≈2.8 req/s) keeps every pubtator3-api call safely
  // under the official 3 req/s cap in all configurations.
  const PUBTATOR_GAP_MS = 350
  let pubtatorChain = Promise.resolve()
  let pubtatorLast = 0
  function pubtatorScheduled(fn) {
    const run = pubtatorChain.then(async () => {
      const now = Date.now()
      const wait = Math.max(0, pubtatorLast + PUBTATOR_GAP_MS - now)
      pubtatorLast = Math.max(now, pubtatorLast + PUBTATOR_GAP_MS)
      if (wait > 0) await sleep(wait)
      return fn()
    })
    pubtatorChain = run.then(() => {}, () => {})
    return run
  }

  async function eutilsGet(path, params, signal, timeoutMs) {
    const p = Object.assign({}, params)
    if (!('tool' in p)) p.tool = TOOL
    if (!('email' in p)) p.email = NCBI_EMAIL
    if (apiKey && !('api_key' in p)) p.api_key = apiKey
    const url = EUTILS + '/' + path + '?' + qs(p)
    const r = await ncbiScheduled(() => httpGet(url, signal, timeoutMs))
    return r.body
  }

  async function jsonGet(url, signal, timeoutMs) {
    const r = await httpGet(url, signal, timeoutMs)
    try {
      return JSON.parse(r.body)
    } catch (e) {
      throw new Error('Invalid JSON from ' + String(url).split('?')[0] + ': ' + r.body.slice(0, 200))
    }
  }

  // Best-effort extra NCBI rate-limit spacer (~3 req/s without an API key).
  // Kept as belt-and-suspenders alongside the global queue.
  async function ncbiPace() {
    try {
      await sleep(NCBI_GAP_MS)
    } catch (e) {
      /* sleep unsupported — skip pacing */
    }
  }

  // ------------------------------------------------------------- tiny helpers
  function asArray(v) {
    if (v === undefined || v === null) return []
    return Array.isArray(v) ? v : [v]
  }

  function cleanXml(s) {
    if (!s) return ''
    // Decode entities FIRST so escaped tags (&lt;sub&gt;) become real tags,
    // then strip tags — otherwise HTML-escaped markup survives the pass.
    return s
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x2019;/g, "'")
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim()
  }

  function xmlTag(xml, tag) {
    const out = []
    const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'g')
    let m
    while ((m = re.exec(xml))) out.push(m[1])
    return out
  }

  // ------------------------------------------------------------- MEDLINE parse
  // efetch db=pubmed rettype=medline → flat, line-based format.
  function parseMedline(text) {
    const records = []
    let current = null
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '')
      if (line.startsWith('PMID-')) {
        if (current) records.push(current.fields)
        const pmid = line.slice(6).trim()
        current = { fields: { PMID: pmid }, lastTag: null, pmid }
        continue
      }
      if (!current) continue
      if (/^\s{6}/.test(line)) {
        if (current.lastTag && current.fields[current.lastTag] !== undefined) {
          current.fields[current.lastTag] += ' ' + line.trim()
        }
        continue
      }
      const m = /^(.{4})-\s?(.*)$/.exec(line)
      if (!m) continue
      const tag = m[1].trim()
      const val = m[2].trim()
      current.lastTag = tag
      if (!(tag in current.fields)) current.fields[tag] = val
      else if (Array.isArray(current.fields[tag])) current.fields[tag].push(val)
      else current.fields[tag] = [current.fields[tag], val]
    }
    if (current) records.push(current.fields)
    return records.map(articleFromFields)
  }

  function parseMedlineDate(dp) {
    const m = /^(\d{4})/.exec(dp || '')
    return m ? { year: m[1] } : undefined
  }

  // =========================================================== pubtator biocjson
  // Parse PubTator3 BioC JSON (publications/export/biocjson) into articles with
  // passages + typed entity annotations. JSON means no XML escaping pitfalls and
  // the values are lossless-JSON safe by construction. Every field is coerced to
  // string/number|null so nothing undefined/NaN ever reaches a tool result.
  function parsePubtatorBiocJson(body) {
    const out = []
    let data
    try {
      data = JSON.parse(body)
    } catch (e) {
      return out
    }
    const docs = (data && data.PubTator3) || []
    for (const doc of docs) {
      if (!doc || typeof doc !== 'object') continue
      const pmid = String((doc.id != null ? doc.id : doc._id) || '').split('|')[0].trim()
      const passages = []
      for (const p of (Array.isArray(doc.passages) ? doc.passages : [])) {
        if (!p || typeof p !== 'object') continue
        const pInfons = (p.infons && typeof p.infons === 'object') ? p.infons : {}
        const entities = []
        for (const a of (Array.isArray(p.annotations) ? p.annotations : [])) {
          if (!a || typeof a !== 'object') continue
          const aInfons = (a.infons && typeof a.infons === 'object') ? a.infons : {}
          const loc = (Array.isArray(a.locations) && a.locations[0]) || {}
          entities.push({
            id: String(aInfons.identifier != null ? aInfons.identifier : (aInfons.normalized_id != null ? aInfons.normalized_id : '')),
            type: String(aInfons.type || ''),
            database: String(aInfons.database || ''),
            name: String(aInfons.name || ''),
            accession: String(aInfons.accession != null ? aInfons.accession : ''),
            surface: String(a.text || ''),
            offset: typeof loc.offset === 'number' ? loc.offset : null,
            length: typeof loc.length === 'number' ? loc.length : null,
          })
        }
        passages.push({ type: String(pInfons.type || ''), text: String(p.text || ''), entities })
      }
      out.push({ pmid, passages })
    }
    return out
  }

  function parseIssns(issns) {
    let issn, eIssn
    for (const i of asArray(issns)) {
      const m = /([\dXx-]+)\s*\((\w+)\)/.exec(i)
      if (!m) continue
      if (m[2].toLowerCase() === 'print') issn = issn || m[1]
      if (m[2].toLowerCase() === 'electronic') eIssn = eIssn || m[1]
    }
    return { issn, eIssn }
  }

  function parseArticleIds(entries) {
    const ids = { doi: null, pmc: null }
    for (const e of asArray(entries)) {
      const m = /^(.+?)\s*\[(\w+)\]$/.exec(e)
      if (!m) continue
      const v = m[1].trim()
      const t = m[2].toLowerCase()
      if (t === 'doi') ids.doi = ids.doi || v
      if (t === 'pmc') ids.pmc = ids.pmc || v
    }
    return ids
  }

  function articleFromFields(fields) {
    const issn = parseIssns(fields.ISSN)
    const ids = parseArticleIds(fields.AID)
    const dp = parseMedlineDate(fields.DP)
    const authors = []
    for (const fau of asArray(fields.FAU)) {
      const parts = fau.split(',').map((p) => p.trim())
      if (parts.length > 1 && parts[0] && parts[1]) {
        const first = parts[1]
        const initials = (first.match(/\b[A-Z]/g) || []).join('')
        authors.push({ lastName: parts[0], firstName: first, initials: initials || undefined })
      } else if (parts[0]) {
        authors.push({ lastName: parts[0] })
      }
    }
    const mesh = asArray(fields.MH).map((mh) => {
      const slash = mh.indexOf('/')
      return { descriptorName: slash >= 0 ? mh.slice(0, slash).trim() : mh.trim() }
    })
    return {
      pmid: fields.PMID,
      pmcId: ids.pmc,
      doi: ids.doi,
      title: fields.TI,
      abstractText: fields.AB,
      authors,
      affiliations: asArray(fields.AD),
      journalInfo: {
        title: fields.JT,
        isoAbbreviation: fields.TA,
        volume: fields.VI,
        issue: fields.IP,
        pages: fields.PG,
        issn: issn.issn,
        eIssn: issn.eIssn,
        publicationDate: dp,
      },
      articleDates: dp ? [dp] : [],
      publicationTypes: asArray(fields.PT),
      meshTerms: mesh,
      grants: asArray(fields.GR),
      keywords: asArray(fields.OT),
    }
  }

  // ------------------------------------------------------------ ESummary parse
  function summaryFromEsummary(uid, r) {
    const doi = (asArray(r.articleids).find((a) => a.idtype === 'doi') || {}).value
    const pmc = (asArray(r.articleids).find((a) => a.idtype === 'pmc') || {}).value
    return {
      pmid: uid,
      title: r.title,
      authors: asArray(r.authors).map((a) => a.name).filter(Boolean),
      source: r.source,
      fullJournalName: r.fulljournalname,
      pubdate: r.pubdate,
      pubstatus: r.pubstatus,
      volume: r.volume,
      issue: r.issue,
      pages: r.pages,
      pubtypes: asArray(r.pubtype),
      issn: r.issn,
      essn: r.essn,
      doi: doi,
      pmcid: pmc,
    }
  }

  // ------------------------------------------------------ eutils ID conversions
  // The PMC ID Converter on www.ncbi.nlm.nih.gov 403s automated callers; the
  // same conversions are done here on the API-friendly eutils host instead.
  async function pmidToPmcid(pmid, signal) {
    const body = await eutilsGet('elink.fcgi', { dbfrom: 'pubmed', db: 'pmc', linkname: 'pubmed_pmc', id: pmid, retmode: 'json' }, signal)
    const j = JSON.parse(body)
    const linkset = asArray(j.linksets)[0] || {}
    const db = asArray(linkset.linksetdbs).find((d) => d.linkname === 'pubmed_pmc')
    const ids = asArray(db && db.links)
    if (!ids.length) return null
    const v = String(ids[0])
    return /^PMC/i.test(v) ? v : 'PMC' + v
  }

  async function pmcidToPmid(pmcid, signal) {
    const bare = String(pmcid).replace(/^PMC/i, '')
    const body = await eutilsGet('elink.fcgi', { dbfrom: 'pmc', db: 'pubmed', linkname: 'pmc_pubmed', id: bare, retmode: 'json' }, signal)
    const j = JSON.parse(body)
    const linkset = asArray(j.linksets)[0] || {}
    const db = asArray(linkset.linksetdbs).find((d) => d.linkname === 'pmc_pubmed')
    const ids = asArray(db && db.links)
    return ids.length ? String(ids[0]) : null
  }

  async function doiToPmid(doi, signal) {
    const body = await eutilsGet('esearch.fcgi', { db: 'pubmed', term: '"' + doi + '"[doi]', retmode: 'json' }, signal)
    const j = JSON.parse(body)
    const ids = asArray(j.esearchresult && j.esearchresult.idlist)
    return ids.length ? String(ids[0]) : null
  }

  async function pmidToDoi(pmid, signal) {
    const body = await eutilsGet('esummary.fcgi', { db: 'pubmed', id: pmid, retmode: 'json' }, signal)
    const j = JSON.parse(body)
    const r = j.result && j.result[String(pmid)]
    if (!r) return null
    const a = asArray(r.articleids).find((x) => x.idtype === 'doi')
    return a ? a.value : null
  }

  // ------------------------------------------------------------- JATS→sections
  function jatsToSections(xml) {
    const out = { title: '', abstract: '', sections: [] }
    const artTitles = xmlTag(xml, 'article-title')
    if (artTitles.length) out.title = cleanXml(artTitles[0])
    const abs = xmlTag(xml, 'abstract')
    if (abs.length) out.abstract = cleanXml(abs[0])
    const opens = []
    const closes = []
    let m
    const openRe = /<sec\b[^>]*>/g
    const closeRe = /<\/sec>/g
    while ((m = openRe.exec(xml))) opens.push(m.index)
    while ((m = closeRe.exec(xml))) closes.push(m.index)
    const secs = []
    const stack = []
    let i = 0
    let j = 0
    while (i < opens.length || j < closes.length) {
      if (j >= closes.length || (i < opens.length && opens[i] < closes[j])) {
        if (stack.length === 0) {
          const tagEnd = xml.indexOf('>', opens[i]) + 1
          secs.push({ start: tagEnd, end: -1 })
        }
        stack.push(opens[i])
        i++
      } else {
        const c = closes[j]
        if (stack.length === 1) secs[secs.length - 1].end = c
        stack.pop()
        j++
      }
    }
    for (const s of secs) {
      if (s.end < 0) continue
      const inner = xml.slice(s.start, s.end)
      const titles = xmlTag(inner, 'title')
      const paras = xmlTag(inner, 'p')
      const secTitle = titles.length ? cleanXml(titles[0]) : ''
      const text = paras.map((p) => cleanXml(p)).filter(Boolean).join('\n\n')
      if (secTitle || text) {
        out.sections.push({ title: secTitle, text })
      }
    }
    return out
  }

  // ------------------------------------------------------------ citation format
  function getYear(article) {
    const jy = article.journalInfo && article.journalInfo.publicationDate && article.journalInfo.publicationDate.year
    if (jy) return jy
    const ay = (article.articleDates || []).find((d) => d.year)
    return ay ? ay.year : 'n.d.'
  }

  function splitPages(pages) {
    if (!pages) return {}
    const parts = String(pages).split(/[-\u2013\u2014]/).map((p) => p.trim())
    let start = parts[0]
    let end = parts[1]
    if (start && end && end.length < start.length) end = start.slice(0, start.length - end.length) + end
    if (start && end) return { start, end }
    return start ? { start } : {}
  }

  function collapseWs(text) {
    return String(text || '').replace(/\s+/g, ' ').trim()
  }

  function escapeBibtex(text) {
    return String(text).replace(/[\\&%$#_{}~^]/g, (ch) => {
      switch (ch) {
        case '\\': return '\\textbackslash{}'
        case '~': return '\\textasciitilde{}'
        case '^': return '\\textasciicircum{}'
        default: return '\\' + ch
      }
    })
  }

  function formatAuthorApa(a) {
    if (a.collectiveName) return a.collectiveName
    const last = a.lastName || ''
    const initials = (a.initials || '').replace(/[^\p{L}]/gu, '')
    if (!initials) return last
    const formatted = Array.from(initials).map((c) => c + '.').join(' ')
    return last ? last + ', ' + formatted : formatted
  }

  function formatAuthorsApa(authors) {
    const f = (authors || []).map(formatAuthorApa)
    if (f.length === 0) return ''
    if (f.length === 1) return f[0]
    if (f.length === 2) return f[0] + ', & ' + f[1]
    if (f.length <= 20) return f.slice(0, -1).join(', ') + ', & ' + f[f.length - 1]
    return f.slice(0, 19).join(', ') + ', ... ' + f[f.length - 1]
  }

  function formatAuthorMla(a, isFirst) {
    if (a.collectiveName) return a.collectiveName
    const last = a.lastName || ''
    const first = a.firstName || ''
    if (!last && !first) return ''
    if (!first) return last
    if (!last) return first
    return isFirst ? last + ', ' + first : first + ' ' + last
  }

  function formatAuthorsMla(authors) {
    const first = (authors || [])[0]
    if (!first) return ''
    if (authors.length === 1) return formatAuthorMla(first, true)
    if (authors.length === 2) {
      const second = authors[1]
      return second ? formatAuthorMla(first, true) + ', and ' + formatAuthorMla(second, false) : formatAuthorMla(first, true)
    }
    return formatAuthorMla(first, true) + ', et al.'
  }

  function formatAuthorBibtex(a) {
    if (a.collectiveName) return '{' + escapeBibtex(a.collectiveName) + '}'
    const last = a.lastName ? escapeBibtex(a.lastName) : ''
    const first = a.firstName ? escapeBibtex(a.firstName) : ''
    if (!last && !first) return ''
    if (!first) return '{' + last + '}'
    if (!last) return first
    return '{' + last + '}, ' + first
  }

  function formatAuthorVancouver(a) {
    if (a.collectiveName) return a.collectiveName
    const last = a.lastName || ''
    const ini = Array.from(a.initials || '').filter((c) => /\p{L}/u.test(c)).join('').toUpperCase()
    if (!last) return ini
    if (!ini) return last
    return last + ' ' + ini
  }

  function formatAuthorsVancouver(authors) {
    const names = (authors || []).map(formatAuthorVancouver).filter(Boolean)
    if (names.length === 0) return ''
    if (names.length <= 6) return names.join(', ')
    return names.slice(0, 6).join(', ') + ', et al.'
  }

  function fmtApa(a) {
    const parts = []
    const authorStr = a.authors && a.authors.length ? formatAuthorsApa(a.authors) : ''
    if (authorStr) parts.push(authorStr.endsWith('.') ? authorStr : authorStr + '.')
    parts.push('(' + getYear(a) + ').')
    if (a.title) parts.push(a.title.replace(/\.\s*$/, '') + '.')
    const j = a.journalInfo
    if (j && j.title) {
      let jp = '*' + j.title + '*'
      if (j.volume) {
        jp += ', *' + j.volume + '*'
        if (j.issue) jp += '(' + j.issue + ')'
      }
      if (j.pages) jp += ', ' + j.pages
      jp += '.'
      parts.push(jp)
    }
    if (a.doi) parts.push('https://doi.org/' + a.doi)
    return parts.join(' ')
  }

  function fmtMla(a) {
    const parts = []
    const authorStr = a.authors && a.authors.length ? formatAuthorsMla(a.authors) : ''
    if (authorStr) parts.push(authorStr.endsWith('.') ? authorStr : authorStr + '.')
    if (a.title) parts.push('"' + a.title.replace(/\.\s*$/, '') + '."')
    const j = a.journalInfo
    if (j && j.title) {
      const d = ['*' + j.title + '*']
      if (j.volume) d.push('vol. ' + j.volume)
      if (j.issue) d.push('no. ' + j.issue)
      const year = getYear(a)
      if (year !== 'n.d.') d.push(year)
      if (j.pages) {
        const isRange = /[-\u2013\u2014]/.test(j.pages)
        d.push((isRange ? 'pp.' : 'p.') + ' ' + j.pages)
      }
      parts.push(d.join(', ') + '.')
    }
    if (a.doi) parts.push('https://doi.org/' + a.doi + '.')
    return parts.join(' ')
  }

  function fmtBibtex(a) {
    const key = 'pmid' + a.pmid
    const typeMap = { Book: 'book', 'Book Chapter': 'inbook', Preprint: 'misc' }
    const ptypes = a.publicationTypes || []
    let entryType = 'article'
    for (const t of ptypes) { if (typeMap[t]) { entryType = typeMap[t]; break } }
    const fields = []
    if (a.authors && a.authors.length) {
      const s = a.authors.map(formatAuthorBibtex).filter(Boolean).join(' and ')
      if (s) fields.push(['author', s])
    }
    if (a.title) fields.push(['title', '{' + escapeBibtex(a.title.replace(/\.\s*$/, '')) + '}'])
    const j = a.journalInfo
    if (j && j.title) fields.push(['journal', escapeBibtex(j.title)])
    const year = getYear(a)
    if (year !== 'n.d.') fields.push(['year', year])
    if (j && j.volume) fields.push(['volume', escapeBibtex(j.volume)])
    if (j && j.issue) fields.push(['number', escapeBibtex(j.issue)])
    if (j && j.pages) fields.push(['pages', escapeBibtex(j.pages)])
    const issn = (j && (j.issn || j.eIssn))
    if (issn) fields.push(['issn', escapeBibtex(issn)])
    if (a.doi) fields.push(['doi', a.doi])
    fields.push(['pmid', String(a.pmid)])
    if (a.pmcId) fields.push(['pmcid', a.pmcId])
    const kw = new Set((a.keywords || []))
    for (const mm of (a.meshTerms || [])) if (mm.descriptorName) kw.add(mm.descriptorName)
    if (kw.size > 0) fields.push(['keywords', [...kw].map((k) => '{' + escapeBibtex(k) + '}').join(', ')])
    const maxLen = Math.max.apply(null, fields.map((f) => f[0].length))
    const lines = fields.map((f) => '  ' + f[0].padEnd(maxLen) + ' = {' + f[1] + '}').join(',\n')
    return '@' + entryType + '{' + key + ',\n' + lines + '\n}'
  }

  function fmtRis(a) {
    const lines = []
    const tag = (code, value) => { if (value !== undefined && value !== null && value !== '') lines.push(code + '  - ' + value) }
    const typeMap = { Book: 'BOOK', 'Book Chapter': 'CHAP', Preprint: 'GEN' }
    let refType = 'JOUR'
    for (const t of (a.publicationTypes || [])) { if (typeMap[t]) { refType = typeMap[t]; break } }
    lines.push('TY  - ' + refType)
    for (const au of (a.authors || [])) {
      if (au.collectiveName) tag('AU', au.collectiveName)
      else if (au.lastName || au.firstName) tag('AU', au.firstName ? au.lastName + ', ' + au.firstName : au.lastName)
    }
    tag('TI', a.title)
    const j = a.journalInfo
    if (j && j.title) tag('JF', j.title)
    if (j && j.isoAbbreviation) tag('JO', j.isoAbbreviation)
    const year = getYear(a)
    if (year !== 'n.d.') tag('PY', year)
    if (j) { tag('VL', j.volume); tag('IS', j.issue) }
    if (j && j.pages) {
      const sp = splitPages(j.pages)
      tag('SP', sp.start); tag('EP', sp.end)
    }
    if (j) tag('SN', j.issn || j.eIssn)
    tag('DO', a.doi)
    tag('AN', a.pmid)
    lines.push('UR  - https://pubmed.ncbi.nlm.nih.gov/' + a.pmid + '/')
    if (a.pmcId) lines.push('UR  - https://pmc.ncbi.nlm.nih.gov/articles/' + a.pmcId + '/')
    const kw = new Set((a.keywords || []))
    for (const mm of (a.meshTerms || [])) if (mm.descriptorName) kw.add(mm.descriptorName)
    for (const k of kw) tag('KW', k)
    if (a.abstractText) tag('AB', collapseWs(a.abstractText))
    lines.push('ER  - ')
    return lines.join('\n')
  }

  function fmtVancouver(a) {
    const seg = []
    const authorStr = a.authors && a.authors.length ? formatAuthorsVancouver(a.authors) : ''
    if (authorStr) seg.push(authorStr.endsWith('.') ? authorStr : authorStr + '.')
    if (a.title) seg.push(a.title.replace(/\.\s*$/, '') + '.')
    const j = a.journalInfo
    const jn = (j && (j.isoAbbreviation || j.title))
    if (jn) seg.push(jn.replace(/\.\s*$/, '') + '.')
    const year = getYear(a)
    let source = year !== 'n.d.' ? year : ''
    if (j && j.volume) {
      source += source ? ';' + j.volume : j.volume
      if (j.issue) source += '(' + j.issue + ')'
      if (j.pages) source += ':' + j.pages
    } else if (j && j.pages) {
      source += source ? ':' + j.pages : j.pages
    }
    if (source) seg.push(source + '.')
    if (a.doi) seg.push('doi: ' + a.doi)
    return seg.join(' ')
  }

  function formatCitations(article, styles) {
    const out = {}
    for (const s of styles) {
      if (s === 'apa') out[s] = fmtApa(article)
      else if (s === 'mla') out[s] = fmtMla(article)
      else if (s === 'bibtex') out[s] = fmtBibtex(article)
      else if (s === 'ris') out[s] = fmtRis(article)
      else if (s === 'vancouver') out[s] = fmtVancouver(article)
    }
    return out
  }

  // ---------------------------------------------------------------- rendering
  // The harness requires tool results to be lossless JSON — any `undefined`
  // value anywhere fails materialization. cleanValue strips undefined recursively.
  function cleanValue(v) {
    if (Array.isArray(v)) return v.map(cleanValue).filter((x) => x !== undefined)
    if (v && typeof v === 'object') {
      const out = {}
      for (const k of Object.keys(v)) {
        const x = v[k]
        if (x === undefined) continue
        out[k] = cleanValue(x)
      }
      return out
    }
    return v
  }

  // NOTE: the harness invokes render(args, value); the default renderer must
  // stringify `value` (the tool result), never `args`.
  function R(args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  }

  // ---------------------------------------------------------------- tool infra
  function register(name, description, parameters, execute, render) {
    const def = defineTool({
      name,
      description,
      parameters,
      output: { schema: { type: 'json' }, render: render || R },
      timeoutMs: 60000,
      isConcurrencySafe() { return true },
      async execute(args, exec) {
        return cleanValue(await execute(args, exec))
      },
    })
    deps.register(def)
  }
  // ===================================================== pubmed_search_articles
  register('pubmed_search_articles', 'Search PubMed with full query syntax, field filters, date ranges, pagination, and optional brief summaries (ESearch + ESummary). KEYWORD-level search — use for complex field-tag/date/pubType queries; PREFER pubmed_pubtator_search when the question names a specific bioconcept or asks for articles supporting a drug/gene-disease relation.',
    {
      query: { type: 'string', required: true, description: 'PubMed search query with boolean and field-tag syntax, e.g. "gut microbiome[title] AND 2023[dp]"' },
      maxResults: { type: 'integer', description: 'Number of results to return (1-1000)', default: 10 },
      offset: { type: 'integer', description: 'Result offset for pagination', default: 0 },
      sort: { type: 'string', enum: ['relevance', 'pub_date', 'first_author', 'journal'], description: 'Sort order' },
      mindate: { type: 'string', description: 'Earliest date, e.g. "2020/01/01" or "2020"' },
      maxdate: { type: 'string', description: 'Latest date, e.g. "2023/12/31"' },
      datetype: { type: 'string', enum: ['pdat', 'edat', 'mdat', 'crdt'], description: 'Date field used by mindate/maxdate (pdat=publication, edat=entry, mdat=modification, crdt=create)' },
      field: { type: 'string', description: 'Restrict the query to a search field, e.g. "title", "author", "journal", "mesh"' },
      pubType: { type: 'string', description: 'Publication type filter, e.g. "Review", "Clinical Trial"' },
      hasAbstract: { type: 'boolean', description: 'Only articles with abstracts', default: false },
      freeFullText: { type: 'boolean', description: 'Only free full-text articles', default: false },
      includeSummaries: { type: 'boolean', description: 'Fetch brief ESummary summaries for the top results', default: true },
    },
    async (args, exec) => {
      let term = args.query
      if (args.field) term = '(' + term + ')[' + args.field + ']'
      const clauses = []
      if (args.pubType) clauses.push('"' + args.pubType + '"[pt]')
      if (args.hasAbstract) clauses.push('hasabstract')
      if (args.freeFullText) clauses.push('free full text[filter]')
      if (clauses.length) term = '(' + term + ') AND ' + clauses.join(' AND ')
      const sortMap = { relevance: 'relevance', pub_date: 'pub date', first_author: 'first author', journal: 'journal' }
      const params = {
        db: 'pubmed', term, retmode: 'json',
        retmax: Math.min(Math.max(1, args.maxResults || 10), 1000),
        retstart: Math.max(0, args.offset || 0),
        tool: TOOL,
      }
      if (args.sort) params.sort = sortMap[args.sort]
      if (args.mindate) params.mindate = args.mindate
      if (args.maxdate) params.maxdate = args.maxdate
      if (args.datetype) params.datetype = args.datetype
      const body = await eutilsGet('esearch.fcgi', params, exec.signal)
      let es
      try { es = JSON.parse(body) } catch (e) { throw new Error('ESearch returned invalid JSON') }
      const er = es.esearchresult || {}
      const ids = asArray(er.idlist).map(String)
      await ncbiPace()
      let summaries = []
      if (args.includeSummaries && ids.length) {
        const uids = ids.join(',')
        const sbody = await eutilsGet('esummary.fcgi', { db: 'pubmed', id: uids, retmode: 'json', tool: TOOL }, exec.signal)
        let sr
        try { sr = JSON.parse(sbody) } catch (e) { sr = null }
        if (sr && sr.result && sr.result.uids) {
          for (const uid of sr.result.uids) {
            const rec = sr.result[String(uid)]
            if (rec) summaries.push(summaryFromEsummary(String(uid), rec))
          }
        }
      }
      return {
        query: args.query,
        appliedTerm: term,
        count: parseInt(er.count, 10) || 0,
        offset: parseInt(er.retstart, 10) || 0,
        returned: ids.length,
        queryTranslation: er.querytranslation,
        warnings: asArray(er.warninglist),
        errors: asArray(er.errorlist),
        ids,
        summaries,
      }
    },
    (args, value) => {
      const lines = []
      lines.push('Search: "' + args.query + '" → ' + (value.count || 0).toLocaleString() + ' results (returned ' + value.returned + ')')
      if (value.queryTranslation && value.queryTranslation !== args.query) lines.push('Effective query: ' + value.queryTranslation)
      if (value.warnings && value.warnings.length) lines.push('Warnings: ' + value.warnings.join('; '))
      for (const s of value.summaries || []) {
        lines.push('- PMID ' + s.pmid + ' [' + (s.pubdate || '') + '] ' + (s.title || ''))
        if (s.authors && s.authors.length) lines.push('    ' + s.authors.join(', ') + (s.source ? ' | ' + s.source : '') + (s.doi ? ' | https://doi.org/' + s.doi : ''))
      }
      return [{ type: 'text', text: lines.join('\n') }]
    })

  // ===================================================== pubmed_fetch_articles
  register('pubmed_fetch_articles', 'Fetch full article metadata by PMIDs — abstract, authors with affiliations, journal, DOI, MeSH terms, grants, publication types (EFetch MEDLINE). With AUTO_GRAPH on (default) results are ALSO auto-merged into the current session knowledge graph — no separate pubmed_graph_add needed.',
    {
      pmids: { type: 'array', items: { type: 'string' }, required: true, description: 'PubMed IDs to fetch (1-200)' },
    },
    async (args, exec) => {
      const pmids = asArray(args.pmids).map(String).filter(Boolean).slice(0, 200)
      if (!pmids.length) throw new Error('No PMIDs provided')
      const body = await eutilsGet('efetch.fcgi', { db: 'pubmed', id: pmids.join(','), rettype: 'medline', retmode: 'text' }, exec.signal)
      const articles = parseMedline(body)
      const result = { articles }
      // AUTO_GRAPH=1: silently merge this batch into the current session graph.
      if (autoGraph && articles.length) {
        const key = sessionKeyOf(exec)
        const g = getSessionGraph(key)
        const r = await mergeGraph(g, articles)
        result.autoGraph = {
          scope: 'session',
          addedNodes: r.addedNodes,
          addedEdges: r.addedEdges,
          nodeCount: Object.keys(g.nodes).length,
          edgeCount: Object.keys(g.edges).length,
        }
      }
      return result
    },
    (args, value) => {
      const lines = []
      if (value.autoGraph) {
        lines.push('[auto-graph] ' + (value.articles || []).length + ' article(s) merged into session graph (+' + value.autoGraph.addedNodes + ' nodes/+' + value.autoGraph.addedEdges + ' edges; now ' + value.autoGraph.nodeCount + ' nodes/' + value.autoGraph.edgeCount + ' edges)')
        lines.push('')
      }
      if (!(value.articles || []).length) lines.push('No articles found for the given PMIDs — they may be invalid or not indexed in PubMed.')
      for (const a of value.articles || []) {
        lines.push('### PMID ' + a.pmid + (a.title ? ' — ' + a.title : ''))
        const j = a.journalInfo
        const authors = (a.authors || []).map((x) => (x.lastName || '') + (x.initials ? ' ' + x.initials : '')).join(', ')
        if (authors) lines.push('Authors: ' + authors)
        if (j && j.title) lines.push('Journal: ' + j.title + (j.volume ? ' ' + j.volume : '') + (j.issue ? '(' + j.issue + ')' : '') + (j.pages ? ':' + j.pages : '') + (getYear(a) !== 'n.d.' ? ' (' + getYear(a) + ')' : ''))
        if (a.doi) lines.push('DOI: https://doi.org/' + a.doi)
        if (a.pmcId) lines.push('PMCID: ' + a.pmcId)
        if (a.abstractText) lines.push('Abstract: ' + a.abstractText)
        if ((a.meshTerms || []).length) lines.push('MeSH: ' + a.meshTerms.map((mm) => mm.descriptorName).join('; '))
        if ((a.grants || []).length) lines.push('Grants: ' + a.grants.join('; '))
        lines.push('')
      }
      return [{ type: 'text', text: lines.join('\n').trim() }]
    })

  // ===================================================== pubmed_spell_check
  register('pubmed_spell_check', 'Spell-check a biomedical query and get NCBI ESpell\'s suggested correction.',
    {
      query: { type: 'string', required: true, description: 'PubMed search query to spell-check' },
    },
    async (args, exec) => {
      // ESpell does not honour retmode=json — parse the XML form like the upstream server.
      const body = await eutilsGet('espell.fcgi', { db: 'pubmed', term: args.query, retmode: 'xml' }, exec.signal)
      const original = cleanXml(xmlTag(body, 'Query')[0] || '') || args.query
      const corrected = cleanXml(xmlTag(body, 'CorrectedQuery')[0] || '')
      return { original, corrected: corrected || original, hasSuggestion: corrected.length > 0 && corrected !== original }
    })

  // ===================================================== pubmed_convert_ids
  register('pubmed_convert_ids', 'Convert between article identifiers (DOI, PMID, PMCID) using NCBI E-utilities (elink/esearch/esummary). Only resolves articles indexed in PubMed Central.',
    {
      ids: { type: 'array', items: { type: 'string' }, required: true, description: 'IDs to convert, all of the same type (1-25)' },
      idtype: { type: 'string', enum: ['doi', 'pmid', 'pmcid'], required: true, description: 'Type of the supplied IDs' },
    },
    async (args, exec) => {
      const ids = asArray(args.ids).map(String).filter(Boolean).slice(0, 25)
      if (!ids.length) throw new Error('No IDs provided')
      const records = []
      for (const rawId of ids) {
        const id = rawId.trim()
        let pmid = null, pmcid = null, doi = null, status = 'ok', errmsg
        try {
          if (args.idtype === 'pmid') {
            pmid = id
            pmcid = await pmidToPmcid(id, exec.signal)
            doi = await pmidToDoi(id, exec.signal)
          } else if (args.idtype === 'pmcid') {
            pmcid = /^PMC/i.test(id) ? id : 'PMC' + id
            pmid = await pmcidToPmid(pmcid, exec.signal)
            if (pmid) doi = await pmidToDoi(pmid, exec.signal)
          } else if (args.idtype === 'doi') {
            pmid = await doiToPmid(id, exec.signal)
            if (pmid) {
              pmcid = await pmidToPmcid(pmid, exec.signal)
              doi = id
            }
          }
          if (!pmid && !pmcid && !doi) status = 'error'
        } catch (e) {
          status = 'error'
          errmsg = e.message
        }
        records.push(Object.assign(
          pmid ? { pmid } : {},
          pmcid ? { pmcid } : {},
          doi ? { doi } : {},
          { status },
          errmsg ? { errmsg } : {},
        ))
        await ncbiPace()
      }
      return { records }
    })

  // ===================================================== pubmed_lookup_citation
  register('pubmed_lookup_citation', 'Resolve partial bibliographic references to PubMed IDs via NCBI ECitMatch. Deterministic matching for known references.',
    {
      citations: {
        type: 'array',
        required: true,
        description: 'Partial citations to match (1-25). Each may include journal, year, volume, firstPage, authorName; at least one field required',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            key: { type: 'string', description: 'Optional caller key echoed back in the result' },
            journal: { type: 'string', description: 'Journal title or ISO abbreviation' },
            year: { type: 'string', description: 'Publication year' },
            volume: { type: 'string', description: 'Volume' },
            firstPage: { type: 'string', description: 'First page number' },
            authorName: { type: 'string', description: 'First author surname' },
          },
        },
      },
    },
    async (args, exec) => {
      const citations = asArray(args.citations).slice(0, 25)
      const bdata = citations
        .map((c, i) => [c.journal || '', c.year || '', c.volume || '', c.firstPage || '', c.authorName || '', c.key || ('c' + i), ''].join('|'))
        .join('\r')
      const url = EUTILS + '/ecitmatch.cgi?' + qs(Object.assign({ db: 'pubmed', retmode: 'xml', bdata }, apiKey ? { api_key: apiKey } : {}))
      const text = (await ncbiScheduled(() => httpGet(url, exec.signal))).body
      const parsed = []
      for (const line of text.split(/[\r\n]+/)) {
        const t = line.trim()
        if (!t) continue
        const parts = t.split('|')
        const key = (parts[5] || '').trim()
        const outcome = (parts[6] || '').trim()
        if (/^\d+$/.test(outcome)) parsed.push({ key, matched: true, pmid: outcome, status: 'matched' })
        else if (outcome.startsWith('AMBIGUOUS')) {
          const csv = /^AMBIGUOUS\s+([\d,\s]+)/.exec(outcome)
          const candidates = csv ? csv[1].split(',').map((p) => p.trim()).filter((p) => /^\d+$/.test(p)) : []
          parsed.push({ key, matched: false, pmid: null, status: 'ambiguous', detail: outcome, candidatePmids: candidates })
        } else {
          parsed.push({ key, matched: false, pmid: null, status: 'not_found', detail: outcome || undefined })
        }
      }
      const byKey = new Map(parsed.map((r) => [r.key, r]))
      const results = citations.map((c, i) => byKey.get(c.key || ('c' + i)) || { key: c.key || ('c' + i), matched: false, pmid: null, status: 'not_found' })
      return { results }
    })

  // ===================================================== pubmed_find_related
  register('pubmed_find_related', 'Find similar articles, citing articles, or references for a given PMID via ELink, enriched with ESummary. Citation-network expansion starting FROM one known article; for concept-based discovery (articles about a bioconcept/relation you do not yet have) use pubmed_pubtator_search instead.',
    {
      pmid: { type: 'string', required: true, description: 'Source PMID' },
      relation: { type: 'string', enum: ['similar', 'cited_by', 'references'], default: 'similar', description: 'Relationship type' },
      maxResults: { type: 'integer', description: 'Max related records to return', default: 20 },
    },
    async (args, exec) => {
      // schema defaults are NOT auto-applied by the framework — be defensive
      const relation = args.relation || 'similar'
      const linkname = { similar: 'pubmed_pubmed', cited_by: 'pubmed_pubmed_citedin', references: 'pubmed_pubmed_refs' }[relation]
      const body = await eutilsGet('elink.fcgi', { dbfrom: 'pubmed', db: 'pubmed', id: args.pmid, linkname, retmode: 'json' }, exec.signal)
      let j
      try { j = JSON.parse(body) } catch (e) { throw new Error('ELink returned invalid JSON') }
      const linkset = asArray(j.linksets)[0] || {}
      const db = asArray(linkset.linksetdbs).find((d) => d.linkname === linkname)
      const ids = asArray(db && db.links).map(String)
      const capped = ids.slice(0, Math.max(1, Math.min(50, args.maxResults || 20)))
      await ncbiPace()
      let summaries = []
      if (capped.length) {
        const sbody = await eutilsGet('esummary.fcgi', { db: 'pubmed', id: capped.join(','), retmode: 'json' }, exec.signal)
        let sr
        try { sr = JSON.parse(sbody) } catch (e) { sr = null }
        if (sr && sr.result && sr.result.uids) {
          for (const uid of sr.result.uids) {
            const rec = sr.result[String(uid)]
            if (rec) summaries.push(summaryFromEsummary(String(uid), rec))
          }
        }
      }
      return { pmid: args.pmid, relation, count: ids.length, ids: capped, summaries }
    },
    (args, value) => {
      const lines = []
      lines.push((value.relation || 'similar') + ' for PMID ' + value.pmid + ': ' + value.count + ' found, showing ' + value.ids.length)
      for (const s of value.summaries || []) {
        lines.push('- PMID ' + s.pmid + ' [' + (s.pubdate || '') + '] ' + (s.title || ''))
      }
      return [{ type: 'text', text: lines.join('\n') }]
    })

  // ===================================================== pubmed_lookup_mesh
  register('pubmed_lookup_mesh', 'Search and explore the MeSH (Medical Subject Headings) vocabulary — descriptor records with tree numbers, scope notes, and entry terms.',
    {
      query: { type: 'string', required: true, description: 'MeSH term to search, e.g. "microbiome" or "Crohn Disease"' },
      maxResults: { type: 'integer', description: 'Max descriptors to return', default: 10 },
    },
    async (args, exec) => {
      // NCBI esearch db=mesh returns Entrez UIDs that encode the canonical MeSH
      // DescriptorUI as the ASCII code of its letter prefix + 6 digits:
      // D=68, C=67 (supplementary concept), Q=81 (qualifier). 68003924 → D003924.
      const decodeUi = (uid) => {
        if (/^\d{8}$/.test(uid)) {
          const letter = { 67: 'C', 68: 'D', 81: 'Q' }[uid.slice(0, 2)]
          if (letter) return letter + uid.slice(2)
        }
        return uid
      }
      const body = await eutilsGet('esearch.fcgi', { db: 'mesh', term: args.query, retmode: 'json', retmax: Math.min(50, Math.max(1, args.maxResults || 10)), tool: TOOL }, exec.signal)
      let es
      try { es = JSON.parse(body) } catch (e) { throw new Error('MeSH ESearch returned invalid JSON') }
      const er = es.esearchresult || {}
      const uids = asArray(er.idlist).map(String)
      const results = []
      if (uids.length) {
        // MeSH details come from eSummary db=mesh (DocSum/Item), NOT efetch.
        const xml = await eutilsGet('esummary.fcgi', { db: 'mesh', id: uids.join(','), retmode: 'xml' }, exec.signal)
        // Depth-aware extraction for nested Item lists: returns the content up
        // to the MATCHING </Item> of the named <Item>, ignoring nested Items
        // (a plain non-greedy regex stops at the first nested </Item>).
        const itemInner = (scope, name) => {
          const openRe = new RegExp('<Item[^>]*Name="' + name + '"[^>]*>', 'g')
          const om = openRe.exec(scope)
          if (!om) return ''
          let depth = 1
          const rest = scope.slice(openRe.lastIndex)
          const tagRe = /<\/?Item\b[^>]*>/g
          let m
          while ((m = tagRe.exec(rest))) {
            if (m[0].charAt(1) === '/') { depth--; if (depth === 0) return rest.slice(0, m.index) }
            else depth++
          }
          return ''
        }
        const leafTexts = (inner) => {
          const out = []
          const re = /<Item[^>]*>([\s\S]*?)<\/Item>/g
          let m
          while ((m = re.exec(inner))) { const t = cleanXml(m[1]); if (t) out.push(t) }
          return out
        }
        // Simple leaf-Item text helper (non-nested items only).
        const itemTexts = (scope, name) => {
          const re = new RegExp('<Item[^>]*Name="' + name + '"[^>]*>([\\s\\S]*?)</Item>', 'g')
          const out = []
          let m
          while ((m = re.exec(scope))) out.push(cleanXml(m[1]))
          return out
        }
        for (const doc of xmlTag(xml, 'DocSum')) {
          const uid = cleanXml(xmlTag(doc, 'Id').join(' ')) || ''
          const ui = decodeUi(uid)
          // DS_MeshTerms is a nested List: first leaf = descriptor name, rest = entry terms.
          const termTexts = leafTexts(itemInner(doc, 'DS_MeshTerms'))
          const record = { ui, name: termTexts[0] || ui }
          if (termTexts.length > 1) record.entryTerms = termTexts.slice(1).filter(Boolean)
          const scopeNotes = itemTexts(doc, 'DS_ScopeNote')
          if (scopeNotes.length) record.scopeNote = scopeNotes[0]
          const treeNums = itemTexts(doc, 'TreeNum').filter((t) => t && !t.startsWith('@'))
          if (treeNums.length) record.treeNumbers = treeNums
          results.push(record)
        }
      }
      return { query: args.query, count: parseInt(er.count, 10) || 0, results }
    },
    (args, value) => {
      const lines = []
      lines.push('MeSH search "' + args.query + '": ' + (value.count || 0) + ' descriptors')
      for (const r of value.results || []) {
        lines.push('- [' + r.ui + '] ' + r.name)
        if (r.treeNumbers && r.treeNumbers.length) lines.push('    Trees: ' + r.treeNumbers.join(', '))
        if (r.scopeNote) lines.push('    ' + r.scopeNote)
        if (r.entryTerms && r.entryTerms.length) lines.push('    Entry terms: ' + r.entryTerms.join('; '))
      }
      return [{ type: 'text', text: lines.join('\n') }]
    })

  // ===================================================== pubmed_format_citations
  register('pubmed_format_citations', 'Generate formatted citations (APA 7th, MLA 9th, BibTeX, RIS, Vancouver ICMJE/NLM) for PubMed articles by PMID.',
    {
      pmids: { type: 'array', items: { type: 'string' }, required: true, description: 'PMIDs to cite (1-50)' },
      styles: {
        type: 'array', required: true,
        items: { type: 'string', enum: ['apa', 'mla', 'bibtex', 'ris', 'vancouver'] },
        description: 'Citation styles to generate',
      },
    },
    async (args, exec) => {
      const pmids = asArray(args.pmids).map(String).filter(Boolean).slice(0, 50)
      if (!pmids.length) throw new Error('No PMIDs provided')
      const styles = asArray(args.styles).filter((s) => ['apa', 'mla', 'bibtex', 'ris', 'vancouver'].includes(s))
      const body = await eutilsGet('efetch.fcgi', { db: 'pubmed', id: pmids.join(','), rettype: 'medline', retmode: 'text' }, exec.signal)
      const articles = parseMedline(body)
      const cited = []
      for (const a of articles) {
        cited.push({ pmid: a.pmid, citations: formatCitations(a, styles) })
      }
      return { formattedCount: cited.length, articles: cited }
    },
    (args, value) => {
      const lines = []
      if (!(value.articles || []).length) lines.push('No articles found for the given PMIDs — nothing to cite.')
      for (const a of value.articles || []) {
        lines.push('=== PMID ' + a.pmid + ' ===')
        for (const s of asArray(args.styles)) {
          if (a.citations && a.citations[s]) lines.push('[' + s + ']\n' + a.citations[s] + '\n')
        }
      }
      return [{ type: 'text', text: lines.join('\n').trim() }]
    })

  // ===================================================== pubmed_pubtator_annotate
  register('pubmed_pubtator_annotate', 'Fetch PubTator3 entity annotations (BioC JSON) for given PMIDs or PMCIDs (mutually exclusive) — typed entities (Gene / Chemical / Disease / Mutation / CellLine / Species) with concept IDs. PMCIDs route to the pmc_export endpoint and pair with pubmed_fetch_fulltext results. Primary strategy for the knowledge graph; falls back to heuristic NLP when unavailable.',
    {
      pmids: { type: 'array', items: { type: 'string' }, description: 'PubMed IDs to annotate (1-100). Mutually exclusive with pmcids' },
      pmcids: { type: 'array', items: { type: 'string' }, description: 'PMC IDs to annotate (1-100); missing PMC prefix is normalized. Mutually exclusive with pmids' },
      full: { type: 'boolean', default: false, description: 'Also annotate the full text when available (default: title + abstract only)' },
    },
    async (args, exec) => {
      const pmids = asArray(args.pmids).map((x) => String(x).trim()).filter(Boolean)
      const pmcids = asArray(args.pmcids).map((x) => String(x).trim()).filter(Boolean)
        .map((s) => (/^pmc\d+$/i.test(s) ? 'PMC' + s.slice(3) : 'PMC' + s))
      if (!pmids.length && !pmcids.length) throw new Error('Provide pmids or pmcids (1-100 each)')
      if (pmids.length && pmcids.length) throw new Error('pmids and pmcids are mutually exclusive — pass exactly one list')
      let url
      if (pmcids.length) {
        url = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/pmc_export/biocjson?pmcids=' + encodeURIComponent(pmcids.slice(0, 100).join(','))
      } else {
        url = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson?pmids=' + encodeURIComponent(pmids.slice(0, 100).join(','))
      }
      if (args.full) url += '&full=true'
      const r = await pubtatorScheduled(() => httpGet(url, exec.signal, 60000))
      const articles = parsePubtatorBiocJson(r.body)
      const flat = []
      for (const a of articles) for (const p of a.passages) for (const e of p.entities) flat.push({ pmid: a.pmid, type: e.type, id: e.id, database: e.database, name: e.name, surface: e.surface })
      const byType = {}
      for (const e of flat) {
        const k = e.type || 'Other'
        if (!byType[k]) byType[k] = []
        byType[k].push(e)
      }
      return { articles, entityCount: flat.length, byType }
    },
    (args, value) => {
      const lines = []
      lines.push('PubTator3 annotations: ' + value.articles.length + ' article(s), ' + value.entityCount + ' entity mention(s)')
      for (const k of Object.keys(value.byType)) {
        const list = value.byType[k]
        lines.push('  ' + k + ': ' + list.length)
        for (const e of list.slice(0, 5)) lines.push('    - ' + e.pmid + ' | ' + (e.database ? e.database + ':' : '') + e.id + ' | ' + e.surface)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    })

  // ===================================================== pubmed_pubtator_entity_id
  register('pubmed_pubtator_entity_id', 'Resolve a free-text bioconcept to candidate concept IDs via PubTator3 autocomplete (e.g. query=IgA → ncbi_gene:973 CD79A). Bridges heuristic keyword nodes to authoritative concept IDs. Feed a returned @ID into pubmed_pubtator_search for relation/semantic article search.',
    {
      query: { type: 'string', required: true, description: 'Free-text bioconcept, e.g. "IgA" or "butyrate"' },
      concept: { type: 'string', enum: ['gene', 'disease', 'chemical', 'variant', 'species', 'cellline', 'mutation'], description: 'Restrict to a bioconcept type (optional)' },
      limit: { type: 'integer', description: 'Max candidate IDs to return', default: 10 },
    },
    async (args, exec) => {
      if (!args.query) throw new Error('No query provided')
      let url = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api/entity/autocomplete/?query=' + encodeURIComponent(args.query)
      if (args.concept) url += '&concept=' + encodeURIComponent(args.concept)
      if (args.limit) url += '&limit=' + Math.min(50, Math.max(1, args.limit || 10))
      const r = await pubtatorScheduled(() => httpGet(url, exec.signal, 30000))
      let list = []
      try {
        list = JSON.parse(r.body)
      } catch (e) { /* not JSON */ }
      const entities = (Array.isArray(list) ? list : []).map((x) => ({
        id: String(x._id || ''),
        biotype: String(x.biotype || ''),
        db: String(x.db || ''),
        dbId: String(x.db_id != null ? x.db_id : ''),
        name: String(x.name || ''),
        match: String(x.match || '').replace(/<[^>]+>/g, ''),
      }))
      return { query: args.query, entityCount: entities.length, entities }
    },
    (args, value) => {
      const lines = []
      lines.push('Entity ID candidates for "' + value.query + '": ' + value.entityCount)
      for (const e of value.entities.slice(0, 10)) {
        lines.push('  - ' + e.id + ' | ' + e.db + ':' + e.dbId + ' | ' + e.biotype + ' | ' + e.name)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    })

  // ===================================================== pubmed_pubtator_relations
  register('pubmed_pubtator_relations', 'Query PubTator3 curated bio-relations between a concept ID and its related entities (treat/cause/inhibit/stimulate/associate/...). e1 from pubmed_pubtator_entity_id (e.g. @GENE_CD79A). Each relation carries a publication count as evidence.',
    {
      e1: { type: 'string', required: true, description: 'Entity ID (accession), e.g. @GENE_CD79A or @DISEASE_IgA_Vasculitis' },
      type: { type: 'string', enum: ['treat', 'cause', 'cotreat', 'convert', 'compare', 'interact', 'associate', 'positive_correlate', 'negative_correlate', 'prevent', 'inhibit', 'stimulate', 'drug_interact'], description: 'Relation type (optional)' },
      e2: { type: 'string', enum: ['gene', 'disease', 'chemical', 'variant'], description: 'Restrict related entities to a type (optional)' },
      limit: { type: 'integer', description: 'Max relations to return', default: 25 },
    },
    async (args, exec) => {
      if (!args.e1) throw new Error('No e1 provided')
      let url = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api/relations?e1=' + encodeURIComponent(args.e1)
      if (args.type) url += '&type=' + encodeURIComponent(args.type)
      if (args.e2) url += '&e2=' + encodeURIComponent(args.e2)
      const r = await pubtatorScheduled(() => httpGet(url, exec.signal, 30000))
      let list = []
      try {
        list = JSON.parse(r.body)
      } catch (e) { /* not JSON */ }
      const rels = (Array.isArray(list) ? list : [])
        .slice(0, Math.min(100, Math.max(1, args.limit || 25)))
        .map((x) => ({
          type: String(x.type || ''),
          source: String(x.source || ''),
          target: String(x.target || ''),
          publications: typeof x.publications === 'number' ? x.publications : null,
        }))
      return { e1: args.e1, relationType: args.type || null, e2Type: args.e2 || null, relationCount: rels.length, relations: rels }
    },
    (args, value) => {
      const lines = []
      lines.push('Relations for ' + value.e1 + (value.relationType ? ' [' + value.relationType + ']' : '') + ': ' + value.relationCount)
      for (const r of value.relations.slice(0, 10)) {
        lines.push('  - ' + r.source + ' --[' + r.type + (r.publications ? '(' + r.publications + ')' : '') + ']--> ' + r.target)
      }
      return [{ type: 'text', text: lines.join('\n') }]
    })

  // ===================================================== pubmed_pubtator_search
  // Semantic / relation search over PubTator3's pre-annotated corpus. Response
  // shape (probed 2025-06, DRF-paginated JSON): { results: [{ _id, pmid,
  // pmcid?, title, journal, authors[], date, doi?, meta_date_publication,
  // score, text_hl (with <m> highlight tags), citations? }], facets:
  // { facet_fields: { journal|type|year: [{name, value}] } }, page_size,
  // current, count, total_pages } — the parser below is tolerant of missing
  // fields and coerces everything to lossless JSON values.
  register('pubmed_pubtator_search', 'Search PubTator3 semantically: free text, entity IDs (@CHEMICAL_remdesivir), boolean combos (@DISEASE_X AND @GENE_Y), or relation queries (relations:treat|@CHEMICAL_X|DISEASE). Returns ranked articles with highlighted snippets and facet statistics (year/journal/type). Resolve @IDs with pubmed_pubtator_entity_id first; found PMIDs can feed pubmed_graph_add. PREFER this over pubmed_search_articles when the question names a specific bioconcept or a drug/gene-disease relation.',
    {
      query: { type: 'string', description: 'Free text, entityId (@CHEMICAL_x), boolean (A AND B), or a raw relations: query. OPTIONAL when relationType + e1 are given (the relations query is assembled for you)', },
      page: { type: 'integer', description: 'Page number (default 1; page_size=10 server-side)', default: 1 },
      relationType: { type: 'string', enum: ['treat', 'cause', 'cotreat', 'convert', 'compare', 'interact', 'associate', 'positive_correlate', 'negative_correlate', 'prevent', 'inhibit', 'stimulate', 'drug_interact', 'ANY'], description: 'Convenience: build relations:{type}|{e1}|{e2} instead of hand-writing the query' },
      e1: { type: 'string', description: 'Convenience: first part of the relations query (entityId like @CHEMICAL_Doxorubicin). Required with relationType' },
      e2: { type: 'string', description: 'Convenience: second part of the relations query (entityId, or entity type DISEASE/GENE/CHEMICAL/VARIANT; default ANY)' },
    },
    async (args, exec) => {
      let text = String(args.query == null ? '' : args.query).trim()
      if (!text && args.relationType && args.e1) {
        const rt = String(args.relationType)
        const p1 = String(args.e1)
        const p2 = args.e2 != null && String(args.e2).trim() !== '' ? String(args.e2).trim() : 'ANY'
        text = 'relations:' + rt + '|' + p1 + '|' + p2
      }
      if (!text) throw new Error('No query provided')
      const page = Math.max(1, Math.min(10000, parseInt(args.page, 10) || 1))
      const url = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api/search/?' + qs({ text, page: String(page) })
      const r = await pubtatorScheduled(() => httpGet(url, exec.signal, 30000))
      let data = null
      try { data = JSON.parse(r.body) } catch (e) { /* not JSON */ }
      const results = (data && Array.isArray(data.results)) ? data.results : []
      const stripHl = (s) => String(s == null ? '' : s).replace(/<\/?m>/g, '')
      const articles = []
      for (const x of results) {
        if (!x || typeof x !== 'object') continue
        const pmid = x.pmid != null ? String(x.pmid) : String(x._id || '')
        if (!pmid) continue
        articles.push({
          pmid,
          pmcid: x.pmcid != null ? String(x.pmcid) : null,
          title: String(x.title || ''),
          journal: String(x.journal || ''),
          date: String(x.meta_date_publication || x.date || ''),
          authors: Array.isArray(x.authors) ? x.authors.slice(0, 3).map((a) => String(a)) : [],
          doi: x.doi != null ? String(x.doi) : null,
          score: typeof x.score === 'number' && Number.isFinite(x.score) ? x.score : null,
          snippet: stripHl(x.text_hl || ''),
        })
      }
      const facets = {}
      const ff = (data && data.facets && data.facets.facet_fields && typeof data.facets.facet_fields === 'object') ? data.facets.facet_fields : {}
      for (const k of ['year', 'journal', 'type']) {
        if (Array.isArray(ff[k])) {
          facets[k] = ff[k].slice(0, 5).map((f) => ({
            name: String((f && f.name) || ''),
            count: (f && typeof f.value === 'number' && Number.isFinite(f.value)) ? f.value : null,
          }))
        }
      }
      return {
        query: text,
        page: (data && typeof data.current === 'number') ? data.current : page,
        pageSize: (data && typeof data.page_size === 'number') ? data.page_size : null,
        totalCount: (data && typeof data.count === 'number') ? data.count : articles.length,
        totalPages: (data && typeof data.total_pages === 'number') ? data.total_pages : null,
        articleCount: articles.length,
        articles,
        facets,
      }
    },
    (args, value) => {
      const lines = []
      lines.push('PubTator3 search "' + value.query + '": ' + value.totalCount + ' hit(s), page ' + value.page + (value.totalPages ? ' of ' + value.totalPages : '') + ' — showing ' + value.articleCount)
      for (const a of value.articles.slice(0, 10)) {
        lines.push('  - PMID ' + a.pmid + (a.pmcid ? ' [' + a.pmcid + ']' : '') + ' | ' + a.title)
        lines.push('      ' + a.journal + (a.date ? ' | ' + a.date : '') + (a.doi ? ' | doi:' + a.doi : '') + (a.score != null ? ' | score ' + a.score : ''))
        if (a.snippet) lines.push('      ' + a.snippet.slice(0, 220))
      }
      if (value.facets.year && value.facets.year.length) {
        lines.push('  years: ' + value.facets.year.map((f) => f.name + '(' + f.count + ')').join(', '))
      }
      if (value.totalPages != null && value.page < value.totalPages) {
        lines.push('  more pages available: page=' + (value.page + 1))
      }
      return [{ type: 'text', text: lines.join('\n') }]
    })

  // ===================================================== pubmed_europepmc_search
  register('pubmed_europepmc_search', 'Search Europe PMC (broader open-access corpus: PubMed MED, PMC, preprints PPR, patents PAT, Agricola AGR). Cursor-based pagination. Use when PubMed alone is too narrow — preprints, patents, non-PubMed venues; for semantic/relation queries use pubmed_pubtator_search instead.',
    {
      query: { type: 'string', required: true, description: 'Europe PMC query, e.g. "cancer AND TITLE:\"gut microbiome\""' },
      sources: {
        type: 'array',
        items: { type: 'string', enum: ['MED', 'PMC', 'PPR', 'PAT', 'AGR'] },
        description: 'Sources to include. MED=PubMed, PMC=PubMed Central, PPR=preprints, PAT=patents, AGR=Agricola',
        default: ['MED', 'PMC', 'PPR'],
      },
      pageSize: { type: 'integer', description: 'Results per page (1-100)', default: 25 },
      cursorMark: { type: 'string', description: 'Pagination cursor; "*" for the first page', default: '*' },
    },
    async (args, exec) => {
      let q = args.query
      const sources = asArray(args.sources).length ? asArray(args.sources) : ['MED', 'PMC', 'PPR']
      const srcClause = '(' + sources.map((s) => 'SRC:"' + s + '"').join(' OR ') + ')'
      q = '(' + q + ') AND ' + srcClause
      const url = EPMC + '/search?' + qs({ query: q, format: 'json', pageSize: Math.min(100, Math.max(1, args.pageSize || 25)), cursorMark: args.cursorMark || '*', resultType: 'core' })
      const data = await jsonGet(url, exec.signal)
      const results = asArray(data.resultList && data.resultList.result)
      return {
        query: q,
        hitCount: data.hitCount || 0,
        nextCursorMark: data.nextCursorMark,
        returned: results.length,
        results: results.map((r) => ({
          id: r.id, source: r.source, pmid: r.pmid, pmcid: r.pmcid, doi: r.doi,
          title: cleanXml(r.title), authorString: cleanXml(r.authorString), journalTitle: cleanXml(r.journalTitle),
          journalVolume: r.journalVolume, issue: r.issue, pageInfo: r.pageInfo, pubYear: r.pubYear,
          isOpenAccess: r.isOpenAccess, inPMC: r.inPMC, inEPMC: r.inEPMC, citedByCount: r.citedByCount,
          abstractSnippet: cleanXml(r.abstractSnippet),
        })),
      }
    },
    (args, value) => {
      const lines = []
      lines.push('Europe PMC: ' + (value.hitCount || 0).toLocaleString() + ' hits (returned ' + value.returned + ')')
      if (value.nextCursorMark && value.nextCursorMark !== '*') lines.push('Next page cursor: ' + value.nextCursorMark)
      for (const r of value.results || []) {
        lines.push('- [' + r.source + ':' + r.id + ']' + (r.pubYear ? ' (' + r.pubYear + ')' : '') + ' ' + (r.title || ''))
        if (r.authorString) lines.push('    ' + r.authorString + (r.journalTitle ? ' | ' + r.journalTitle : ''))
      }
      return [{ type: 'text', text: lines.join('\n') }]
    })

  // ===================================================== pubmed_europepmc_fetch
  register('pubmed_europepmc_fetch', 'Fetch complete Europe PMC records (including the untruncated abstract) by source + epmcId — the only identifier preprints, patents, and Agricola records carry.',
    {
      records: {
        type: 'array', required: true,
        description: 'Records to fetch (1-25), each addressed by source + id as returned by pubmed_europepmc_search',
        items: {
          type: 'object', additionalProperties: true,
          properties: {
            source: { type: 'string', enum: ['MED', 'PMC', 'PPR', 'PAT', 'AGR'], required: true, description: 'Europe PMC source' },
            id: { type: 'string', required: true, description: 'Europe PMC record id (epmcId)' },
          },
        },
      },
    },
    async (args, exec) => {
      const records = asArray(args.records).slice(0, 25)
      const out = []
      for (const r of records) {
        try {
          const q = 'SRC:' + r.source + ' AND EXT_ID:' + r.id
          const url = EPMC + '/search?' + qs({ query: q, format: 'json', resultType: 'core', pageSize: 1 })
          const data = await jsonGet(url, exec.signal)
          const hit = asArray(data.resultList && data.resultList.result)[0]
          if (!hit) { out.push({ source: r.source, id: r.id, found: false }); continue }
          out.push({
            found: true, source: hit.source, id: hit.id, pmid: hit.pmid, pmcid: hit.pmcid, doi: hit.doi,
            title: cleanXml(hit.title), authorString: cleanXml(hit.authorString), journalTitle: cleanXml(hit.journalTitle),
            journalVolume: hit.journalVolume, issue: hit.issue, pageInfo: hit.pageInfo, pubYear: hit.pubYear,
            abstractText: cleanXml(hit.abstractText), isOpenAccess: hit.isOpenAccess, inPMC: hit.inPMC,
          })
        } catch (e) {
          out.push({ source: r.source, id: r.id, found: false, error: e.message })
        }
      }
      return { records: out }
    },
    (args, value) => {
      const lines = []
      for (const r of value.records || []) {
        if (!r.found) { lines.push('- [' + r.source + ':' + r.id + '] NOT FOUND' + (r.error ? ' — ' + r.error : '')); continue }
        lines.push('### [' + r.source + ':' + r.id + '] ' + (r.title || ''))
        if (r.authorString) lines.push('Authors: ' + r.authorString)
        if (r.journalTitle) lines.push('Journal: ' + r.journalTitle + (r.pubYear ? ' (' + r.pubYear + ')' : ''))
        if (r.pmid) lines.push('PMID: ' + r.pmid)
        if (r.doi) lines.push('DOI: ' + r.doi)
        if (r.abstractText) lines.push('Abstract: ' + r.abstractText)
        lines.push('')
      }
      return [{ type: 'text', text: lines.join('\n').trim() }]
    })

  // ===================================================== pubmed_fetch_fulltext
  register('pubmed_fetch_fulltext', 'Fetch full-text article bodies. Accepts pmids, pmcids, or dois (provide exactly one group). Resolves IDs to PMC and extracts JATS to readable sections. Best-effort: articles without an open PMC copy are reported unavailable.',
    {
      pmids: { type: 'array', items: { type: 'string' }, description: 'PubMed IDs (auto-resolved to PMC)' },
      pmcids: { type: 'array', items: { type: 'string' }, description: 'PMC IDs, e.g. "PMC1234567"' },
      dois: { type: 'array', items: { type: 'string' }, description: 'DOIs (auto-resolved to PMC)' },
      maxCharacters: { type: 'integer', description: 'Cap body characters per article', default: 40000 },
    },
    async (args, exec) => {
      const cap = Math.max(1000, args.maxCharacters || 40000)
      const articles = []
      const fetchPmc = async (pmcid, idType, id) => {
        try {
          const bare = String(pmcid).replace(/^PMC/i, '')
          const xml = await eutilsGet('efetch.fcgi', { db: 'pmc', id: bare, rettype: 'xml', retmode: 'xml' }, exec.signal)
          const s = jatsToSections(xml)
          if (!s.title && !s.abstract && s.sections.length === 0) {
            articles.push({ id, idType, source: null, unavailable: 'not-found', triedTiers: ['pmc'] })
            return
          }
          let text = ''
          if (s.title) text += '## ' + s.title + '\n\n'
          if (s.abstract) text += '**Abstract:** ' + s.abstract + '\n\n'
          for (const sec of s.sections) {
            const heading = sec.title ? '## ' + sec.title + '\n\n' : ''
            text += heading + sec.text + '\n\n'
          }
          const truncated = text.length > cap
          if (truncated) text = text.slice(0, cap) + '\n[truncated]'
          articles.push({ id, idType, source: 'pmc', pmcid: String(pmcid), title: s.title || undefined, body: text, truncated, sections: s.sections })
        } catch (e) {
          articles.push({ id, idType, source: null, unavailable: 'fetch-failed', triedTiers: ['pmc'], error: e.message })
        }
      }
      const resolvePmid = async (pmid) => {
        try {
          const c = await pmidToPmcid(pmid, exec.signal)
          return c
        } catch (e) { return null }
      }
      for (const doi of asArray(args.dois).slice(0, 10)) {
        try {
          const pmid = await doiToPmid(doi, exec.signal)
          const pmcid = pmid ? await pmidToPmcid(pmid, exec.signal) : null
          if (pmcid) await fetchPmc(pmcid, 'doi', doi)
          else articles.push({ id: doi, idType: 'doi', source: null, unavailable: 'no-pmc' })
        } catch (e) {
          articles.push({ id: doi, idType: 'doi', source: null, unavailable: 'service-error', error: e.message })
        }
      }
      for (const pmid of asArray(args.pmids).slice(0, 10)) {
        const pmcid = await resolvePmid(pmid)
        if (pmcid) await fetchPmc(pmcid, 'pmid', pmid)
        else articles.push({ id: pmid, idType: 'pmid', source: null, unavailable: 'no-pmc' })
      }
      for (const pmcid of asArray(args.pmcids).slice(0, 10)) {
        await fetchPmc(pmcid, 'pmcid', pmcid)
      }
      return { articles }
    },
    (args, value) => {
      const lines = []
      for (const a of value.articles || []) {
        if (a.source) {
          lines.push('### ' + a.id + ' (via ' + a.source + ') — ' + (a.title || ''))
          lines.push(a.body || '')
          if (a.truncated) lines.push('[truncated]')
        } else {
          lines.push('### ' + a.id + ' — unavailable: ' + (a.unavailable || 'unknown'))
          if (a.error) lines.push('  ' + a.error)
        }
        lines.push('')
      }
      return [{ type: 'text', text: lines.join('\n').trim() }]
    })

  // ================================================== knowledge graph engine (P1)
  // Deterministic keyword extraction: MeSH terms (weighted) + title/abstract
  // token frequency. No LLM dependency.
  const STOPWORDS = new Set((
    'a an and the of to in on for with by from or as is are was were be been at this that these those it its not no but more most such their his her our your other between among via within into over under about across during against without until than then also both each any some what which who whom whose when where why how do does did can could should would may might shall will must i we you they he she them him us me my your into through out up down off onto towards new review study studies results methods method conclusion background objective aim purpose design data analysis group groups effect effects role roles impact influence regulation metabolism metabolic interaction interactions mechanism mechanisms function functions'
  ).split(/\s+/))

  function tokenize(text) {
    if (!text) return []
    return String(text).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
      .map((t) => t.replace(/^-+|-+$/g, ''))
      .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOPWORDS.has(t))
  }

  function articleKeywords(a) {
    const freq = new Map()
    const bump = (w, n) => freq.set(w, (freq.get(w) || 0) + n)
    for (const m of (a.meshTerms || [])) {
      const d = String(m.descriptorName || '').replace(/^\*/, '').toLowerCase()
      if (d) bump(d, 3) // MeSH weighted higher
    }
    for (const w of tokenize([a.title, a.abstractText].filter(Boolean).join(' '))) bump(w, 1)
    return [...freq.entries()].sort((x, y) => y[1] - x[1]).map(([word, count]) => ({ word, count }))
  }
  // Keyword extraction is injectable: the npm bundle passes an NLP-enhanced
  // extractor (compromise) via deps.extractKeywords; the plain token+MeSH one
  // above remains the portable fallback (dynamic-plugin / no-dependency mode).
  const extractKeywords = deps.extractKeywords || articleKeywords

  function newGraph() {
    return { version: 1, updatedAt: new Date().toISOString(), nodes: {}, edges: {} }
  }

  function edgeId(e) {
    if (e.kind === 'relation') return 'rel:' + e.source + '>' + e.target + ':' + (e.label || '')
    if (e.kind === 'article-concept') return 'ac:' + e.source + '>' + e.target
    if (e.directed) return 'art:' + e.source + '>' + e.target
    return 'co:' + (e.source < e.target ? e.source + '~' + e.target : e.target + '~' + e.source)
  }

  // Basic fallback directed-relation extractor (no NLP dependency): finds
  // "<X> <relation-verb> <Y>" spans in the title+abstract with a plain regex.
  const RELATION_VERB_RE = /\b(regulates?|promotes?|inhibits?|produces?|drives?|mediates?|induces?|enhances?|modulates?|influences?|increases?|reduces?|alters?|activates?|suppresses?|impairs?|restores?|exacerbates?)\b/
  function basicRelations(a) {
    const out = []
    const text = [a.title, a.abstractText].filter(Boolean).join('. ')
    const re = /\b([a-z][a-z0-9\s-]{1,40}?)\s+((?:regulates?|promotes?|inhibits?|produces?|drives?|mediates?|induces?|enhances?|modulates?|influences?|increases?|reduces?|alters?|activates?|suppresses?|impairs?|restores?|exacerbates?))\s+([a-z][a-z0-9\s-]{1,40}?)[\s.,;]/gi
    let m
    while ((m = re.exec(text))) {
      const source = m[1].toLowerCase().replace(/\s+/g, ' ').trim()
      const relation = m[2].toLowerCase()
      const target = m[3].toLowerCase().replace(/\s+/g, ' ').trim()
      if (source && target && source !== target) out.push({ source, relation, target })
    }
    return out
  }
  // Relations are injectable like keywords: the bundle uses the compromise-based
  // extractor; the regex above is the portable fallback.
  const extractRelations = deps.extractRelations || basicRelations
  // PubTator concept extraction is injectable, with a DEFAULT that calls
  // PubTator3 (biocjson) via the shared httpGet + parser. On ANY failure it
  // returns [] so the heuristic layer still runs (fallback/degradation).
  // `deps.pubtatorEnabled` (default true) lets users turn PubTator enrichment
  // off entirely (config PUBTATOR: false).
  const pubtatorEnabled = deps.pubtatorEnabled !== false
  const pubtatorCache = new Map() // pmid -> entities[] (per plugin instance)
  async function defaultExtractPubtator(a) {
    if (!a.pmid) return []
    if (pubtatorCache.has('ann:' + a.pmid)) return pubtatorCache.get('ann:' + a.pmid)
    const empty = []
    try {
      const url = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api/publications/export/biocjson?pmids=' + encodeURIComponent(String(a.pmid))
      const r = await pubtatorScheduled(() => httpGet(url, undefined, 30000))
      const docs = parsePubtatorBiocJson(r.body)
      const doc = docs.find((x) => x.pmid === String(a.pmid)) || docs[0] || null
      const entities = []
      if (doc) for (const p of doc.passages) for (const e of p.entities) entities.push({ type: e.type, id: e.id, database: e.database, surface: e.surface, accession: e.accession })
      // dedupe by type:id
      const seen = new Map()
      for (const e of entities) if (e.id) seen.set(e.type + ':' + e.id, e)
      const out = [...seen.values()]
      pubtatorCache.set('ann:' + a.pmid, out)
      return out
    } catch (e) {
      pubtatorCache.set('ann:' + a.pmid, empty)
      return empty
    }
  }
  // Curated concept→concept relations (PubTator3 relations API). Default impl
  // queries relations for the article's first few concepts (bounded) and only
  // keeps edges between concepts both present in this article. On failure → [].
  async function defaultExtractPubtatorRelations(concepts) {
    const out = []
    if (!concepts || !concepts.length) return out
    try {
      const byAccession = new Map()
      for (const c of concepts) if (c.accession) byAccession.set(c.accession, c.nodeId)
      for (const c of concepts.slice(0, 3)) {
        if (!c.accession) continue
        const url = 'https://www.ncbi.nlm.nih.gov/research/pubtator3-api/relations?e1=' + encodeURIComponent(c.accession)
        const r = await pubtatorScheduled(() => httpGet(url, undefined, 30000))
        let list = []
        try { list = JSON.parse(r.body) } catch (e) { /* not JSON */ }
        // Filter to this article's intra-concept relations FIRST, then cap at 20
        // per probed concept. Slicing before filtering used to silently drop
        // in-article edges of hub concepts whose relations list is long: a
        // relevant edge sitting past entry 20 (among many off-article targets)
        // never survived the raw cap.
        const rels = (Array.isArray(list) ? list : [])
          .filter((rel) => rel && String(rel.source || '') === c.accession && byAccession.has(String(rel.target || '')))
          .slice(0, 20)
        for (const rel of rels) {
          const tNode = byAccession.get(String(rel.target || ''))
          out.push({ source: c.nodeId, target: tNode, type: String(rel.type || 'associate'), publications: typeof rel.publications === 'number' ? rel.publications : null })
        }
      }
    } catch (e) { /* fall back */ }
    return out
  }
  const extractPubtator = deps.extractPubtator || (pubtatorEnabled ? defaultExtractPubtator : (() => []))
  const extractPubtatorRelations = deps.extractPubtatorRelations || (pubtatorEnabled ? defaultExtractPubtatorRelations : (() => []))

  async function mergeGraph(graph, articles) {
    let addedNodes = 0
    let addedEdges = 0
    for (const a of asArray(articles)) {
      if (!a || (!a.pmid && !a.title)) continue
      const aid = 'article:' + (a.pmid || ('t:' + String(a.title || '').slice(0, 40)))
      const now = new Date().toISOString()
      if (!graph.nodes[aid]) {
        graph.nodes[aid] = {
          id: aid, label: a.title || aid, type: 'article', count: 0, sources: [], lastSeen: now,
          detail: { pmid: a.pmid, doi: a.doi, pmcid: a.pmcId, title: a.title },
        }
        addedNodes++
      }
      const n = graph.nodes[aid]
      n.count++
      if (a.pmid && !n.sources.includes(String(a.pmid))) n.sources.push(String(a.pmid))
      n.lastSeen = now
      const kwIds = []
      for (const kw of extractKeywords(a)) {
        const kid = 'kw:' + kw.word
        kwIds.push(kid)
        if (!graph.nodes[kid]) {
          graph.nodes[kid] = { id: kid, label: kw.word, type: 'keyword', count: 0, sources: [], lastSeen: now }
          addedNodes++
        }
        const kn = graph.nodes[kid]
        kn.count += kw.count
        if (a.pmid && !kn.sources.includes(String(a.pmid))) kn.sources.push(String(a.pmid))
        kn.lastSeen = now
        const e = { source: aid, target: kid, kind: 'article-keyword', directed: true, weight: kw.count, lastSeen: now }
        const id = edgeId(e)
        if (!graph.edges[id]) { graph.edges[id] = e; addedEdges++ }
        else { graph.edges[id].weight += kw.count; graph.edges[id].lastSeen = now }
      }
      // undirected keyword-keyword co-occurrence within this article
      for (let i = 0; i < kwIds.length; i++) {
        for (let j = i + 1; j < kwIds.length; j++) {
          const e = { source: kwIds[i], target: kwIds[j], kind: 'co-occur', directed: false, weight: 1, lastSeen: now }
          const id = edgeId(e)
          if (!graph.edges[id]) { graph.edges[id] = e; addedEdges++ }
          else { graph.edges[id].weight++; graph.edges[id].lastSeen = now }
        }
      }
      // directed keyword->keyword relation edges ("X regulates Y" etc.)
      for (const rel of extractRelations(a)) {
        const s = 'kw:' + rel.source
        const t = 'kw:' + rel.target
        for (const node of [s, t]) {
          if (!graph.nodes[node]) {
            graph.nodes[node] = { id: node, label: node.slice(3), type: 'keyword', count: 0, sources: [], lastSeen: now }
            addedNodes++
          }
          if (a.pmid && !graph.nodes[node].sources.includes(String(a.pmid))) graph.nodes[node].sources.push(String(a.pmid))
          graph.nodes[node].lastSeen = now
        }
        const e = { source: s, target: t, kind: 'relation', label: rel.relation, directed: true, weight: 1, lastSeen: now }
        const id = edgeId(e)
        if (!graph.edges[id]) { graph.edges[id] = e; addedEdges++ }
        else { graph.edges[id].weight++; graph.edges[id].lastSeen = now }
      }
      // PubTator concept nodes: dedup by stable concept ID across all articles.
      const articleConcepts = []
      for (const ent of await extractPubtator(a)) {
        if (!ent || typeof ent !== 'object') continue
        const type = String(ent.type || 'Other')
        const cid = String(ent.id != null ? ent.id : '')
        if (!cid) continue
        const nodeId = 'concept:' + type + ':' + cid
        if (!graph.nodes[nodeId]) {
          graph.nodes[nodeId] = {
            id: nodeId, label: ent.surface || cid, type: 'concept', subtype: type,
            conceptId: cid, database: String(ent.database || ''),
            accession: String(ent.accession || ''),
            count: 0, sources: [], lastSeen: now,
          }
          addedNodes++
        }
        const cn = graph.nodes[nodeId]
        cn.count++
        if (a.pmid && !cn.sources.includes(String(a.pmid))) cn.sources.push(String(a.pmid))
        cn.lastSeen = now
        articleConcepts.push({ nodeId, type, conceptId: cid, accession: String(ent.accession || '') })
        const ce = { source: aid, target: nodeId, kind: 'article-concept', label: type, directed: true, weight: 1, lastSeen: now }
        const cid_ = edgeId(ce)
        if (!graph.edges[cid_]) { graph.edges[cid_] = ce; addedEdges++ }
        else { graph.edges[cid_].weight++; graph.edges[cid_].lastSeen = now }
      }
      // curated concept→concept relation edges (PubTator3 relations API)
      for (const rel of await extractPubtatorRelations(articleConcepts)) {
        if (!rel || typeof rel !== 'object') continue
        const s = String(rel.source || '')
        const t = String(rel.target || '')
        if (!s || !t || !graph.nodes[s] || !graph.nodes[t]) continue
        const e = { source: s, target: t, kind: 'relation', label: String(rel.type || 'associate'), directed: true, weight: (typeof rel.publications === 'number' && rel.publications > 0) ? rel.publications : 1, lastSeen: now }
        const id = edgeId(e)
        if (!graph.edges[id]) { graph.edges[id] = e; addedEdges++ }
        else { graph.edges[id].weight += e.weight; graph.edges[id].lastSeen = now }
      }
    }
    graph.updatedAt = new Date().toISOString()
    return { addedNodes, addedEdges }
  }

  // Graph-to-graph union (used when committing session graph into user graph).
  function mergeGraphs(target, source) {
    let addedNodes = 0
    let addedEdges = 0
    for (const n of Object.values(source.nodes)) {
      if (!target.nodes[n.id]) { target.nodes[n.id] = JSON.parse(JSON.stringify(n)); addedNodes++ }
      else {
        const t = target.nodes[n.id]
        t.count += n.count
        for (const s of n.sources) if (!t.sources.includes(s)) t.sources.push(s)
        t.lastSeen = n.lastSeen
        if (n.detail && !t.detail) t.detail = n.detail
      }
    }
    for (const e of Object.values(source.edges)) {
      const id = edgeId(e)
      if (!target.edges[id]) { target.edges[id] = JSON.parse(JSON.stringify(e)); addedEdges++ }
      else { target.edges[id].weight += e.weight; target.edges[id].lastSeen = e.lastSeen }
    }
    target.updatedAt = new Date().toISOString()
    return { addedNodes, addedEdges }
  }

  function graphSummary(graph) {
    const nodes = Object.values(graph.nodes)
    return {
      version: graph.version,
      nodeCount: nodes.length,
      edgeCount: Object.keys(graph.edges).length,
      articles: nodes.filter((n) => n.type === 'article').length,
      keywords: nodes.filter((n) => n.type === 'keyword').length,
      concepts: nodes.filter((n) => n.type === 'concept').length,
      updatedAt: graph.updatedAt,
    }
  }

  function graphJson(graph) {
    return { nodes: Object.values(graph.nodes), edges: Object.values(graph.edges), stats: graphSummary(graph) }
  }

  function filterGraph(gj, minCount) {
    const keep = new Set()
    for (const n of gj.nodes) {
      if (n.type === 'article' || n.type === 'concept' || n.count >= Math.max(1, minCount || 1)) keep.add(n.id)
    }
    // relation-edge endpoints are meaningful even when their token count is 0
    // (they are multi-word phrases, not frequent single tokens) — keep them so
    // directed "X regulates Y" edges survive filtering.
    for (const e of gj.edges) if (e.kind === 'relation') { keep.add(e.source); keep.add(e.target) }
    return {
      nodes: gj.nodes.filter((n) => keep.has(n.id)),
      edges: gj.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
      stats: gj.stats,
    }
  }

  const sessionGraphs = new Map()
  function sessionKeyOf(exec) {
    return (exec && exec.agent && exec.agent.id) ? String(exec.agent.id) : 'default'
  }
  function getSessionGraph(key) {
    if (!sessionGraphs.has(key)) sessionGraphs.set(key, newGraph())
    return sessionGraphs.get(key)
  }
  const storage = deps.storage
  function loadUserGraph() {
    return (storage && storage.loadUserGraph) ? storage.loadUserGraph() : null
  }
  function saveUserGraph(graph) {
    if (storage && storage.saveUserGraph) { storage.saveUserGraph(graph); return true }
    return false
  }
  function clearUserGraph() {
    if (storage && storage.clearUserGraph) { storage.clearUserGraph(); return true }
    return false
  }

  // ============================================================ mermaid output
  // Turn a graph into a colored mermaid `flowchart` (NPG palette) so the model
  // can render it as a dsh-ui card: articles #E64B35FF, keywords #00A087FF,
  // relation edges #DC0000FF, co-occurrence/article edges #8491B4FF.
  function escMermaid(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;')
      .replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')
  }
  function buildMermaid(gj, maxKeywords) {
    const articles = gj.nodes.filter((n) => n.type === 'article')
    const kws = gj.nodes.filter((n) => n.type === 'keyword')
      .sort((a, b) => (b.count - a.count) || String(a.label).localeCompare(String(b.label)))
      .slice(0, Math.max(5, maxKeywords || 15))
    const concepts = gj.nodes.filter((n) => n.type === 'concept')
    const chosen = new Map()
    let idx = 0
    const lines = ['flowchart LR']
    const addNode = (n, label) => {
      if (chosen.has(n.id)) return
      const mid = 'n' + idx++
      chosen.set(n.id, mid)
      lines.push('  ' + mid + '["' + escMermaid(label) + '"]')
      return mid
    }
    for (const n of articles) {
      const pm = (n.detail && n.detail.pmid) || ''
      const title = (n.label || '').length > 26 ? String(n.label).slice(0, 26) + '…' : (n.label || '')
      addNode(n, (pm ? 'PMID ' + pm + ' · ' : '') + title)
    }
    for (const n of kws) addNode(n, n.label)
    for (const n of concepts) addNode(n, n.label + (n.conceptId ? ' [' + n.conceptId + ']' : ''))
    // always bring in both endpoints of directed relation edges so red arrows
    // appear even when the relation phrases are not among the top keywords
    const nodeById = new Map(gj.nodes.map((n) => [n.id, n]))
    for (const e of gj.edges) {
      if (e.kind !== 'relation') continue
      const n1 = nodeById.get(e.source)
      const n2 = nodeById.get(e.target)
      if (n1 && !chosen.has(e.source)) addNode(n1, n1.label)
      if (n2 && !chosen.has(e.target)) addNode(n2, n2.label)
    }
    const artIds = articles.map((n) => chosen.get(n.id)).filter(Boolean)
    const concIds = concepts.map((n) => chosen.get(n.id)).filter(Boolean)
    const kwIds = [...chosen.values()].slice(artIds.length + concIds.length)
    if (artIds.length) lines.push('  classDef article fill:#E64B35FF,color:#fff,stroke:#C0392B')
    if (kwIds.length) lines.push('  classDef kw fill:#00A087FF,color:#fff,stroke:#00897B')
    if (concIds.length) lines.push('  classDef concept fill:#3C5488FF,color:#fff,stroke:#2C3E50')
    if (artIds.length) lines.push('  class ' + artIds.join(',') + ' article')
    if (kwIds.length) lines.push('  class ' + kwIds.join(',') + ' kw')
    if (concIds.length) lines.push('  class ' + concIds.join(',') + ' concept')
    let edgeIndex = 0
    const undIds = []
    const relIds = []
    for (const e of gj.edges) {
      const s = chosen.get(e.source)
      const t = chosen.get(e.target)
      if (s === undefined || t === undefined) continue
      if (e.kind === 'relation') {
        lines.push('  ' + s + ' -->|' + escMermaid(e.label || '') + '| ' + t)
        relIds.push(edgeIndex)
      } else {
        lines.push('  ' + s + ' --- ' + t)
        undIds.push(edgeIndex)
      }
      edgeIndex++
    }
    if (undIds.length) lines.push('  linkStyle ' + undIds.join(',') + ' stroke:#8491B4FF')
    if (relIds.length) lines.push('  linkStyle ' + relIds.join(',') + ' stroke:#DC0000FF,stroke-width:2px')
    return lines.join('\n')
  }

  // ===================================================== pubmed_extract_keywords
  register('pubmed_extract_keywords', 'Extract keywords from fetched PubMed articles — MeSH terms (weighted) + title/abstract token frequency. Deterministic, no LLM. Inspection only — pubmed_graph_add already runs this internally when merging.',
    {
      articles: { type: 'array', required: true, description: 'Article objects as returned by pubmed_fetch_articles' },
      maxKeywords: { type: 'integer', description: 'Max keywords per article', default: 15 },
    },
    (args) => {
      const out = []
      for (const a of asArray(args.articles)) {
        if (!a) continue
        out.push({ pmid: a.pmid, title: a.title, keywords: extractKeywords(a).slice(0, Math.max(5, args.maxKeywords || 15)) })
      }
      return { articles: out }
    })

  // ===================================================== pubmed_graph_add
  register('pubmed_graph_add', 'Incrementally add a batch of retrieved articles to the CURRENT SESSION knowledge graph (in-memory, per-session). Does NOT touch the user graph until pubmed_graph_commit is called. Keyword extraction and PubTator concept/relation enrichment run automatically — do NOT call pubmed_extract_keywords first.',
    {
      articles: { type: 'array', required: true, description: 'Article objects as returned by pubmed_fetch_articles' },
    },
    async (args, exec) => {
      const key = sessionKeyOf(exec)
      const g = getSessionGraph(key)
      const r = await mergeGraph(g, asArray(args.articles))
      return { scope: 'session', sessionKey: key, addedNodes: r.addedNodes, addedEdges: r.addedEdges, stats: graphSummary(g) }
    })

  // ===================================================== pubmed_graph_get
  register('pubmed_graph_get', 'Get the current session or user knowledge graph — as nodes/edges JSON, or as a colored mermaid flowchart (NPG palette) you can render as a dsh-ui card.',
    {
      scope: { type: 'string', enum: ['session', 'user', 'both'], default: 'session', description: 'Which graph to return' },
      minCount: { type: 'integer', description: 'Only include keyword nodes with count >= this (trim large graphs)', default: 1 },
      format: { type: 'string', enum: ['json', 'mermaid'], default: 'json', description: 'json: nodes+edges; mermaid: colored flowchart code — wrap it in a dsh-ui mermaid fence to display the card' },
      maxKeywords: { type: 'integer', description: 'mermaid mode: max keyword nodes (top by count)', default: 15 },
    },
    (args, exec) => {
      // schema defaults are NOT auto-applied by the framework — be defensive
      const scope = args.scope || 'session'
      const key = sessionKeyOf(exec)
      const out = {}
      if (scope === 'session' || scope === 'both') out.session = filterGraph(graphJson(getSessionGraph(key)), args.minCount)
      if (scope === 'user' || scope === 'both') {
        const ug = loadUserGraph()
        out.user = ug ? filterGraph(graphJson(ug), args.minCount) : { nodes: [], edges: [], stats: { version: 1, nodeCount: 0, edgeCount: 0, articles: 0, keywords: 0, concepts: 0 } }
      }
      if (args.format === 'mermaid') {
        out.mermaid = {}
        if (out.session) out.mermaid.session = buildMermaid(out.session, args.maxKeywords)
        if (out.user) out.mermaid.user = buildMermaid(out.user, args.maxKeywords)
      }
      return out
    },
    (args, value) => {
      if (args.format === 'mermaid') {
        const lines = []
        for (const scope of ['session', 'user']) {
          const code = value.mermaid && value.mermaid[scope]
          if (code) lines.push('<!-- ' + scope + ' mermaid -->\n' + code)
        }
        return [{ type: 'text', text: lines.join('\n\n').trim() || '(no graph data)' }]
      }
      const lines = []
      for (const scope of ['session', 'user']) {
        const g = value[scope]
        if (!g) continue
        lines.push(scope + ' graph: ' + g.stats.nodeCount + ' nodes (' + g.stats.articles + ' articles, ' + g.stats.keywords + ' keywords' + (g.stats.concepts ? ', ' + g.stats.concepts + ' concepts' : '') + '), ' + g.stats.edgeCount + ' edges')
        const topKws = g.nodes.filter((n) => n.type === 'keyword').sort((a, b) => b.count - a.count).slice(0, 12)
        if (topKws.length) lines.push('  top keywords: ' + topKws.map((k) => k.label + '(' + k.count + ')').join(', '))
        const cons = g.nodes.filter((n) => n.type === 'concept').slice(0, 8)
        if (cons.length) lines.push('  concepts: ' + cons.map((c) => c.label + '[' + c.conceptId + ']').join(', '))
      }
      return [{ type: 'text', text: lines.join('\n') || '(no graph data)' }]
    })

  // ===================================================== pubmed_graph_commit
  register('pubmed_graph_commit', 'Explicitly merge the CURRENT SESSION graph into your persistent USER knowledge graph (opt-in — nothing is added to the user graph automatically).',
    {
      confirm: { type: 'boolean', default: true, description: 'Set true to confirm the merge into your user knowledge graph' },
    },
    (args, exec) => {
      // schema default (confirm: true) is NOT auto-applied — default to true,
      // allow an explicit false to cancel.
      const confirm = args.confirm !== false
      if (!confirm) return { committed: false, note: 'commit cancelled (set confirm: true to proceed)' }
      const key = sessionKeyOf(exec)
      const g = getSessionGraph(key)
      if (Object.keys(g.nodes).length === 0) return { committed: false, note: 'session graph is empty' }
      if (!storage || !storage.saveUserGraph) return { committed: false, note: 'user graph persistence is unavailable in this mode (requires the npm bundle)' }
      const ug = loadUserGraph() || newGraph()
      const r = mergeGraphs(ug, g)
      saveUserGraph(ug)
      return { committed: true, scope: 'user', addedNodes: r.addedNodes, addedEdges: r.addedEdges, stats: graphSummary(ug) }
    })

  // ===================================================== pubmed_graph_reset
  register('pubmed_graph_reset', 'Clear the session graph, and optionally the persistent user graph.',
    {
      scope: { type: 'string', enum: ['session', 'user'], default: 'session', description: 'Which graph to clear' },
    },
    (args, exec) => {
      const key = sessionKeyOf(exec)
      if (args.scope === 'user') {
        return clearUserGraph() ? { cleared: 'user' } : { cleared: 'user', note: 'persistence unavailable; nothing cleared' }
      }
      sessionGraphs.delete(key)
      return { cleared: 'session' }
    })
}
