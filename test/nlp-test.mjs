// nlp-test.mjs — verify the NLP keyword extractor (compromise) wired through
// the core produces noun-phrase keywords (vs the basic token+MeSH extractor).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nlpExtractKeywords } from '../lib/nlp.js'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const factory = new Function(source + '\n; return registerPubmedTools')
const registerPubmedTools = factory()
const tools = {}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (opts) => opts,
  register: (def) => { tools[def.name] = def },
  httpGet: async () => { throw new Error('network not used') },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  extractKeywords: nlpExtractKeywords,
})

const article = {
  pmid: '38504383',
  title: 'Microbiota-derived indoles alleviate intestinal inflammation and modulate microbiome by microbial cross-feeding',
  doi: '10.1186/s40168-024-01750-y',
  meshTerms: [{ descriptorName: 'Tryptophan' }, { descriptorName: 'Dysbiosis' }, { descriptorName: 'Microbiota' }, { descriptorName: 'Indoles' }, { descriptorName: 'Inflammation' }],
  abstractText: 'The host-microbiota interaction plays a crucial role in maintaining homeostasis and disease susceptibility, and microbial tryptophan metabolites are potent modulators of host physiology. Indole-3-lactic acid (ILA) is a key molecule produced by Lactobacillus in protecting against intestinal inflammation and correcting microbial dysbiosis. Lactobacillus metabolizes tryptophan into ILA, augmenting the expression of key bacterial enzymes implicated in tryptophan metabolism, leading to the synthesis of indole derivatives including indole-3-propionic acid and indole-3-acetic acid. ILA-mediated microbial cross-feeding enhanced indole derivatives production under conditions of dysbiosis.',
}

const res = await tools.pubmed_extract_keywords.execute({ articles: [article], maxKeywords: 20 }, { agent: { id: 'nlp-test' }, signal: AbortSignal.timeout(5000) })
const kws = res.articles[0].keywords
console.log('NLP keywords (' + kws.length + '):')
for (const k of kws.slice(0, 18)) console.log('  ' + k.word + ' (' + k.count + ')')
if (kws.length < 5) { console.log('NLP EXTRACT FAIL'); process.exit(1) }
console.log('NLP TEST OK')
