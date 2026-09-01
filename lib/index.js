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
import { nlpExtractKeywords, nlpExtractRelations, nlpAvailable, RELATION_VERB_STEMS, STOPWORDS } from './nlp.js'

/** Plugin identity used by loader diagnostics. */
export const name = 'pubmed'

/**
 * P4-一.5: single boolean parser — patch YAML configs often carry quoted
 * strings ("false"), which a bare !!value would misread as true. Exported for
 * tests; used for every boolean config/env flag in apply().
 */
export function parseBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue
  if (typeof value === 'boolean') return value
  const s = String(value).trim().toLowerCase()
  if (['false', '0', 'no', 'off'].includes(s)) return false
  if (['true', '1', 'yes', 'on'].includes(s)) return true
  return defaultValue
}

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
 * P4-二.1 修复：timeoutMs 现在真正生效——与 caller signal 经 AbortSignal.any
 * 组合，黑洞窗口下的 connect 不再悬挂到 OS 级 ~21s（此前 timeout 参数被忽略）。
 */
async function httpGet(url, signal, timeoutMs) {
  const options = {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; dsh-pubmed/1.0)',
    },
    redirect: 'follow',
  }
  const signals = []
  if (signal) signals.push(signal)
  if (timeoutMs && timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs))
  if (signals.length === 1) options.signal = signals[0]
  else if (signals.length > 1) options.signal = AbortSignal.any(signals)
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
// P3.9: self-register the bundled skill doc into ~/.dsh/skills (a scanned
// discovery root) at activation — clean installs get the routing guide with
// zero manual copying. Idempotent, version-aware (rewrites when content
// differs), non-fatal; SKILL_DOC:false (config/env) disables it.
function installSkillDoc(cfg) {
  try {
    const enabled = parseBool(cfg.SKILL_DOC ?? process.env.SKILL_DOC, true)
    if (!enabled) return 'disabled'
    const base = process.env.DSH_HOME || join(homedir(), '.dsh')
    const dir = join(base, 'skills', 'dsh-pubmed')
    const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'dsh-pubmed', 'SKILL.md')
    const content = readFileSync(src, 'utf8')
    mkdirSync(dir, { recursive: true })
    const dst = join(dir, 'SKILL.md')
    let existing = ''
    try { existing = readFileSync(dst, 'utf8') } catch (e) { /* first install */ }
    if (existing === content) return 'unchanged'
    writeFileSync(dst, content, 'utf8')
    return existing ? 'updated' : 'installed'
  } catch (e) {
    console.warn('[dsh-pubmed] skill doc self-registration skipped:', String((e && e.message) || e))
    return 'failed'
  }
}

export function apply(ctx, pluginConfig) {
  const cfg = pluginConfig || {}
  // P3.9: register the skill doc before tools load (failure is non-fatal).
  const skillDoc = installSkillDoc(cfg)
  if (skillDoc === 'installed' || skillDoc === 'updated') console.log('[dsh-pubmed] skill doc ' + skillDoc + ' at ~/.dsh/skills/dsh-pubmed/SKILL.md')
  const coreUrl = new URL('./pubmed-core.js', import.meta.url)
  const source = readFileSync(fileURLToPath(coreUrl), 'utf8')
  // pubmed-core.js defines `function registerPubmedTools(ctx, deps)`.
  const factory = new Function(source + '\n; return registerPubmedTools')
  const registerPubmedTools = factory()
  const tools = ctx.get('tools')
  if (tools === undefined) throw new Error('tools service unavailable')
  const autoGraph = parseBool(cfg.AUTO_GRAPH ?? process.env.AUTO_GRAPH, true)
  const pubtatorEnabled = parseBool(cfg.PUBTATOR ?? process.env.PUBTATOR, true)
  // P4-三.2: promote the two README-documented options to real configuration.
  const europepmcEnabled = parseBool(cfg.EUROPEPMC_ENABLED ?? process.env.EUROPEPMC_ENABLED, true)
  const ncbiEmail = cfg.NCBI_ADMIN_EMAIL || process.env.NCBI_ADMIN_EMAIL || ''
  registerPubmedTools(ctx, {
    defineTool,
    register: (def) => tools.register(def),
    httpGet,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    // NCBI API key — from the profile patch `config` (preferred), else env.
    apiKey: cfg.NCBI_API_KEY || process.env.NCBI_API_KEY || '',
    // P4-三.2: NCBI compliance contact email (was a hardcoded constant).
    ncbiEmail,
    // AUTO_GRAPH: auto-merge every pubmed_fetch_articles result into the
    // current session knowledge graph (default ON, config/env can disable).
    autoGraph,
    // PUBTATOR: enrich graph with PubTator concept nodes + curated relations
    // (default ON; falls back to heuristic NLP on any PubTator failure).
    pubtatorEnabled,
    // P4-三.2: EUROPEPMC_ENABLED gate (default ON) — registers the two EPM
    // tools and enables NCBI-failure fallbacks to EBI.
    europepmcEnabled,
    // NLP-enhanced keyword extraction (compromise); undefined when compromise
    // isn't installed so the core falls back to its built-in token+MeSH
    // extractor (lazy-loaded in nlp.js — see nlpAvailable).
    extractKeywords: nlpAvailable ? nlpExtractKeywords : undefined,
    // NLP-directed-relation extraction ("X regulates Y"); same fallback rule.
    extractRelations: nlpAvailable ? nlpExtractRelations : undefined,
    // P4-一.2/一.3: shared word lists (single source: lib/constants.js).
    relationVerbStems: RELATION_VERB_STEMS,
    stopwords: STOPWORDS,
    // P1a: graph-edge evidence PMIDs (default ON; PUBTATOR_EDGE_EVIDENCE: false
    // / env '0' turns it off). P3.4: relation-probe width (default 3, cap 6).
    pubtatorEdgeEvidence: parseBool(cfg.PUBTATOR_EDGE_EVIDENCE ?? process.env.PUBTATOR_EDGE_EVIDENCE, true),
    pubtatorRelationProbe: parseInt(cfg.PUBTATOR_RELATION_PROBE || process.env.PUBTATOR_RELATION_PROBE, 10) || 3,
    // P4-二.1: articles per merge call that get curated-relation probing
    // (default 8, cap 50) — caps total PubTator calls for large batches.
    pubtatorProbeArticles: parseInt(cfg.PUBTATOR_RELATION_PROBE_ARTICLES || process.env.PUBTATOR_RELATION_PROBE_ARTICLES, 10) || 8,
    storage: {
      loadUserGraph,
      saveUserGraph,
      clearUserGraph,
    },
  })
}
