// smoke.mjs — validates the shared pubmed-core.js with a fetch-based transport
// (the same deps the dsh-pubmed bundle plugin provides at runtime).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const factory = new Function(source + '\n; return registerPubmedTools')
const registerPubmedTools = factory()

const tools = {}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (opts) => opts,
  register: (def) => { tools[def.name] = def },
  httpGet: (url, signal, timeoutMs) =>
    fetch(url, { signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; dsh-pubmed/1.0)' } }).then(async (res) => {
      const body = await res.text()
      if (res.status >= 400) throw new Error('HTTP ' + res.status + ' from ' + String(url).split('?')[0])
      return { status: res.status, body }
    }),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})

console.log('registered tools (' + Object.keys(tools).length + '): ' + Object.keys(tools).join(', '))
const signal = AbortSignal.timeout(60000)

const search = await tools.pubmed_search_articles.execute(
  { query: 'gut microbiome[title] AND 2023[dp]', maxResults: 2, includeSummaries: true }, { signal })
console.log('search -> count=' + search.count + ' returned=' + search.returned + ' summaries=' + search.summaries.length)

const spell = await tools.pubmed_spell_check.execute({ query: 'microbiom' }, { signal })
console.log('spell -> ' + JSON.stringify(spell))

const conv = await tools.pubmed_convert_ids.execute({ ids: ['23193287'], idtype: 'pmid' }, { signal })
console.log('convert -> ' + JSON.stringify(conv.records[0]))

const cite = await tools.pubmed_format_citations.execute({ pmids: ['23193287'], styles: ['apa', 'vancouver'] }, { signal })
console.log('citations -> ' + cite.formattedCount + ' formatted; apa head: ' + cite.articles[0].citations.apa.slice(0, 60))

const full = await tools.pubmed_fetch_fulltext.execute({ pmcids: ['PMC3531190'], maxCharacters: 1500 }, { signal })
const a = full.articles[0]
console.log('fulltext -> source=' + a.source + ' sections=' + (a.sections || []).length + ' bodyLen=' + (a.body || '').length)

console.log('SMOKE OK')
