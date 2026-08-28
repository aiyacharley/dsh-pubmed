// dsh-pubmed — DSH npm bundle plugin entry.
//
// Loads the shared, transport-agnostic core (lib/pubmed-core.js) and registers
// the 11 PubMed model tools on the host `tools` registry using Node's global
// `fetch` for HTTP. The bundle row is declared in cordis.patch.yml; install
// with `dsh plugin --profile <name> add dsh-pubmed@latest` or add the package
// to the profile's bundles list manually.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { nlpExtractKeywords, nlpExtractRelations } from './nlp.js'

/** Plugin identity used by loader diagnostics. */
export const name = 'pubmed'

/** Hard dependency: the host tool registry that receives the 11 tools. */
export const inject = ['tools']

/**
 * One HTTP GET through Node's global fetch. Rejects on non-2xx; returns
 * `{ status, body }` otherwise. `signal` is the tool-call cancellation signal.
 */
function httpGet(url, signal, timeoutMs) {
  const options = {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; dsh-pubmed/1.0)',
    },
    redirect: 'follow',
  }
  if (signal) options.signal = signal
  return fetch(url, options).then(async (res) => {
    const text = await res.text()
    if (res.status >= 400) {
      throw new Error('HTTP ' + res.status + ' from ' + String(url).split('?')[0] + ': ' + text.slice(0, 400))
    }
    return { status: res.status, body: text }
  })
}

/**
 * Persistent user-knowledge-graph storage. A single JSON file under the DSH
 * home (or the user home) holds the accumulated personal graph; read/modify/
 * write on each explicit commit. Kept separate from the shared core so the
 * dynamic-plugin mode (no node:fs) simply reports persistence unavailable.
 */
function userGraphPath() {
  return join(process.env.DSH_HOME || homedir(), 'dsh-pubmed-graph.json')
}

function loadUserGraph() {
  const p = userGraphPath()
  try {
    if (!existsSync(p)) return null
    const raw = readFileSync(p, 'utf8')
    const data = JSON.parse(raw)
    if (data && typeof data === 'object' && data.nodes && data.edges) return data
    return null
  } catch (e) {
    return null
  }
}

function saveUserGraph(graph) {
  const p = userGraphPath()
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(graph, null, 2), 'utf8')
    return true
  } catch (e) {
    return false
  }
}

function clearUserGraph() {
  const p = userGraphPath()
  try {
    rmSync(p, { force: true })
    return true
  } catch (e) {
    return false
  }
}

/**
 * Cordis plugin body. Reads the shared core and evaluates it (plain JS, no
 * exports), then calls `registerPubmedTools(ctx, deps)` with a fetch-based
 * transport and the real tool registry.
 */
export function apply(ctx) {
  const coreUrl = new URL('./pubmed-core.js', import.meta.url)
  const source = readFileSync(fileURLToPath(coreUrl), 'utf8')
  // pubmed-core.js defines `function registerPubmedTools(ctx, deps)`.
  const factory = new Function(source + '\n; return registerPubmedTools')
  const registerPubmedTools = factory()
  const tools = ctx.get('tools')
  if (tools === undefined) throw new Error('tools service unavailable')
  registerPubmedTools(ctx, {
    defineTool,
    register: (def) => tools.register(def),
    httpGet,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // NCBI API key from the environment — never hardcoded or logged.
    apiKey: process.env.NCBI_API_KEY || '',
    // AUTO_GRAPH=1: auto-merge every pubmed_fetch_articles result into the
    // current session knowledge graph.
    autoGraph: process.env.AUTO_GRAPH === '1' || process.env.AUTO_GRAPH === 'true',
    // NLP-enhanced keyword extraction (compromise); the core falls back to its
    // built-in token+MeSH extractor if this is absent.
    extractKeywords: nlpExtractKeywords,
    // NLP-directed-relation extraction ("X regulates Y"); falls back to a regex.
    extractRelations: nlpExtractRelations,
    storage: {
      loadUserGraph,
      saveUserGraph,
      clearUserGraph,
    },
  })
}
