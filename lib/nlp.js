// lib/nlp.js — optional pure-JS NLP keyword extraction (compromise).
// Provided to the shared core via deps.extractKeywords; the core falls back to
// its built-in token+MeSH extractor when this is absent (e.g. dynamic-plugin
// mode or when the dependency isn't installed). Keeps the plugin zero-config.
import nlp from 'compromise'

const STOPWORDS = new Set((
  'a an and the of to in on for with by from or as is are was were be been at this that these those it its not no but more most such their his her our your other between among via within into over under about across during against without until than then also both each any some what which who whom whose when where why how do does did can could should would may might shall will must i we you they he she them him us me my our your new review study studies results methods result conclusion background objective aim purpose design data analysis group groups effect effects role roles impact influence regulation metabolism metabolic interaction interactions mechanism mechanisms function functions'
).split(/\s+/))

function normalizePhrase(p) {
  return String(p).toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^-+|-+$/g, '')
}

/**
 * NLP keyword extractor: MeSH terms (weighted) + compromise-extracted noun
 * phrases from the title and abstract. Multi-word concepts become single
 * keyword nodes (e.g. "bile acid metabolism") instead of raw tokens.
 */
export function nlpExtractKeywords(article) {
  const freq = new Map()
  const bump = (w, n) => freq.set(w, (freq.get(w) || 0) + n)

  for (const m of (article.meshTerms || [])) {
    const d = String(m.descriptorName || '').replace(/^\*/, '').toLowerCase().trim()
    if (d) bump(d, 3)
  }

  const text = [article.title, article.abstractText].filter(Boolean).join('. ')
  if (text.trim()) {
    const doc = nlp(text)
    for (const phrase of doc.match('#Noun+').out('array')) {
      // Skip phrases contaminated by an abbreviation token (e.g. "X (ILA)")
      // — they fragment into noise ("acid ila").
      if (/\b[A-Z]{2,6}\b/.test(phrase)) continue
      const norm = normalizePhrase(phrase)
      const words = norm.split(' ').filter(Boolean)
      if (!words.length || words.length > 4) continue
      if (words.every((w) => STOPWORDS.has(w))) continue
      bump(norm, 1)
    }
  }

  return [...freq.entries()].sort((x, y) => y[1] - x[1]).map(([word, count]) => ({ word, count }))
}

// Causal/regulatory verbs matched by STEM so every form works (regulate,
// regulates, regulated, regulating…). Covers the causal verbs that dominate
// biomedical abstracts; relation direction = subject -> verb -> object.

/**
 * Directed-relation extractor (Step B): finds "X <verb> Y" triples in the title
 * + abstract. Uses a stem-based verb regex (handles past/present/progressive)
 * around noun-ish spans. Returns normalized `{ source, relation, target }`.
 */
export function nlpExtractRelations(article) {
  const text = [article.title, article.abstractText].filter(Boolean).join('. ')
  const out = []
  if (!text.trim()) return out
  const re = /\b([a-z][a-z0-9\s-]{1,40}?)\s+((?:regulat|promot|inhibit|produc|driv|mediat|induc|enhanc|modulat|influenc|increas|reduc|alter|activat|suppress|impair|restor|exacerbat|aggravat|govern|shape|predict|stratify|disrupt|trigger)\w*)\s+([a-z][a-z0-9\s-]{1,40}?)[\s.,;]/gi
  let m
  while ((m = re.exec(text))) {
    const source = m[1].toLowerCase().replace(/\s+/g, ' ').trim()
    const relation = m[2].toLowerCase()
    const target = m[3].toLowerCase().replace(/\s+/g, ' ').trim()
    if (source && target && source !== target && source !== relation && target !== relation) {
      out.push({ source, relation, target })
    }
  }
  return out
}
