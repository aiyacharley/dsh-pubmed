// dsh-pubmed — DSH npm bundle plugin entry.
//
// Loads the shared, transport-agnostic core (lib/pubmed-core.js) and registers
// the 20 PubMed / Europe PMC / PubTator3 model tools on the host `tools`
// registry using Node's global `fetch` for HTTP. The bundle row is declared in
// cordis.patch.yml; install with
// `dsh plugin --profile <name> add dsh-pubmed@latest` or add the package
// to the profile's bundles list manually.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { nlpExtractKeywords, nlpExtractRelations, nlpAvailable } from './nlp.js'

/** Plugin identity used by loader diagnostics. */
export const name = 'pubmed'

/** Hard dependency: the host tool registry that receives the 20 tools. */
export const inject = ['tools']

/**
 * Optional proxy transport: when HTTPS_PROXY / HTTP_PROXY is set in the process
 * environment, HTTP failures are retried through it via undici.ProxyAgent.
 * Lazy + dynamic import keeps the plugin loadable even if 'undici' isn't
 * resolvable (falls back to direct-only).
 */
let _proxyState = 0 // 0=unchecked 1=no-proxy 2=ready 3=unavailable
let _proxyFetch = null
async function getProxyFetch() {
  if (_proxyState === 1 || _proxyState === 2) return _proxyFetch
  if (_proxyState === 3) return null
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
  if (!proxy) { _proxyState = 1; return null }
  try {
    const undici = await import('undici')
    const agent = new undici.ProxyAgent({ uri: proxy, requestTimeout: 30000 })
    _proxyFetch = (u, o) => undici.fetch(u, Object.assign({}, o, { dispatcher: agent }))
    _proxyState = 2
  } catch (e) {
    _proxyState = 3
  }
  return _proxyFetch
}

/**
 * One HTTP GET. Direct fetch first; on a NETWORK failure (not an HTTP error),
 * retries through the proxy when one is configured. Rejects on non-2xx; returns
 * `{ status, body }` otherwise. `signal` is the tool-call cancellation signal.
 */
async function httpGet(url, signal, timeoutMs) {
  const options = {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; dsh-pubmed/1.0)',
    },
    redirect: 'follow',
  }
  if (signal) options.signal = signal
  const doFetch = async (f) => {
    const res = await f(url, options)
    const text = await res.text()
    if (res.status >= 400) {
      throw new Error('HTTP ' + res.status + ' from ' + String(url).split('?')[0] + ': ' + text.slice(0, 400))
    }
    return { status: res.status, body: text }
  }
  try {
    return await doFetch(fetch)
  } catch (e) {
    // HTTP status errors are real answers — do not retry through the proxy.
    if (/^HTTP \d+/.test(String(e.message || ''))) throw e
    const proxyFetch = await getProxyFetch()
    if (proxyFetch) return await doFetch(proxyFetch)
    throw e
  }
}

/**
 * Persistent user-knowledge-graph storage. A single JSON file under the DSH
 * home (or the user home) holds the accumulated personal graph; read/modify/
 * write on each explicit commit. Kept separate from the shared core so the
 * dynamic-plugin mode (no node:fs) simply reports persistence unavailable.
 */
function userGraphPath() {
  // Always under a `.dsh` directory: ${DSH_HOME}/… when the host sets it,
  // otherwise ${home}/.dsh/… (the conventional DSH user-data location).
  const base = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(base, 'dsh-pubmed-graph.json')
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
 *
 * `config` comes from the profile patch row (`- override: { id: pubmed, config }
 * …`), which is the preferred way to supply `NCBI_API_KEY` / `AUTO_GRAPH`
 * because process-environment variables may not reach the bundle depending on
 * how DSH is launched. The environment remains a fallback.
 */
export function apply(ctx, pluginConfig) {
  const cfg = pluginConfig || {}
  const coreUrl = new URL('./pubmed-core.js', import.meta.url)
  const source = readFileSync(fileURLToPath(coreUrl), 'utf8')
  // pubmed-core.js defines `function registerPubmedTools(ctx, deps)`.
  const factory = new Function(source + '\n; return registerPubmedTools')
  const registerPubmedTools = factory()
  const tools = ctx.get('tools')
  if (tools === undefined) throw new Error('tools service unavailable')
  // AUTO_GRAPH defaults ON; disable explicitly with config `AUTO_GRAPH: false`
  // or env `AUTO_GRAPH=0`/`false`.
  let autoGraph = true
  if (cfg.AUTO_GRAPH !== undefined && cfg.AUTO_GRAPH !== null && cfg.AUTO_GRAPH !== '') autoGraph = !!cfg.AUTO_GRAPH
  else if (process.env.AUTO_GRAPH !== undefined && process.env.AUTO_GRAPH !== '') autoGraph = process.env.AUTO_GRAPH === '1' || process.env.AUTO_GRAPH === 'true'
  // PUBTATOR enrichment defaults ON; disable with config `PUBTATOR: false` or
  // env `PUBTATOR=0`/`false`. The core still degrades to heuristic NLP when the
  // PubTator HTTP call fails.
  let pubtatorEnabled = true
  if (cfg.PUBTATOR !== undefined && cfg.PUBTATOR !== null && cfg.PUBTATOR !== '') pubtatorEnabled = !!cfg.PUBTATOR
  else if (process.env.PUBTATOR !== undefined && process.env.PUBTATOR !== '') pubtatorEnabled = process.env.PUBTATOR === '1' || process.env.PUBTATOR === 'true'
  registerPubmedTools(ctx, {
    defineTool,
    register: (def) => tools.register(def),
    httpGet,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // NCBI API key — from the profile patch `config` (preferred), else env.
    apiKey: cfg.NCBI_API_KEY || process.env.NCBI_API_KEY || '',
    // AUTO_GRAPH: auto-merge every pubmed_fetch_articles result into the
    // current session knowledge graph (default ON, config/env can disable).
    autoGraph,
    // PUBTATOR: enrich graph with PubTator concept nodes + curated relations
    // (default ON; falls back to heuristic NLP on any PubTator failure).
    pubtatorEnabled,
    // NLP-enhanced keyword extraction (compromise); undefined when compromise
    // isn't installed so the core falls back to its built-in token+MeSH
    // extractor (lazy-loaded in nlp.js — see nlpAvailable).
    extractKeywords: nlpAvailable ? nlpExtractKeywords : undefined,
    // NLP-directed-relation extraction ("X regulates Y"); same fallback rule.
    extractRelations: nlpAvailable ? nlpExtractRelations : undefined,
    // P1a: graph-edge evidence PMIDs (default ON; PUBTATOR_EDGE_EVIDENCE: false
    // / env '0' turns it off). P3.4: relation-probe width (default 3, cap 6).
    pubtatorEdgeEvidence: !(cfg.PUBTATOR_EDGE_EVIDENCE === false || cfg.PUBTATOR_EDGE_EVIDENCE === 'false' || cfg.PUBTATOR_EDGE_EVIDENCE === '0' || process.env.PUBTATOR_EDGE_EVIDENCE === '0' || process.env.PUBTATOR_EDGE_EVIDENCE === 'false'),
    pubtatorRelationProbe: parseInt(cfg.PUBTATOR_RELATION_PROBE || process.env.PUBTATOR_RELATION_PROBE, 10) || 3,
    storage: {
      loadUserGraph,
      saveUserGraph,
      clearUserGraph,
    },
  })
}
