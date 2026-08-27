// dsh-pubmed — DSH npm bundle plugin entry.
//
// Loads the shared, transport-agnostic core (lib/pubmed-core.js) and registers
// the 11 PubMed model tools on the host `tools` registry using Node's global
// `fetch` for HTTP. The bundle row is declared in cordis.patch.yml; install
// with `dsh plugin --profile <name> add dsh-pubmed@latest` or add the package
// to the profile's bundles list manually.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

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
  })
}
