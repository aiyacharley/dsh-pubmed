# dsh-pubmed

[![npm version](https://img.shields.io/npm/v/dsh-pubmed)](https://www.npmjs.com/package/dsh-pubmed)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-pubmed)

**PubMed / Europe PMC literature search plugin for DeepSeek Harness (DSH)**

Ports the core capabilities of [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server)
into native DSH model tools: search, article metadata, full text, citation formatting, MeSH and ID
conversion, plus a **personal literature knowledge graph** — 16 tools in total, talking directly to
NCBI E-utilities and the Europe PMC REST API. No MCP client configuration required.

## ✨ Features (16 tools)

| Tool | Description |
|---|---|
| `pubmed_search_articles` | Full PubMed search (boolean / field / date / sort / paging / summaries) |
| `pubmed_fetch_articles` | Structured articles by PMID (authors / abstract / MeSH / grants / DOI / PMCID) |
| `pubmed_fetch_fulltext` | PMC full text (JATS → sectioned body, best-effort) |
| `pubmed_format_citations` | APA 7 / MLA 9 / BibTeX / RIS / Vancouver citations |
| `pubmed_find_related` | Similar / citing / references (ELink + ESummary) |
| `pubmed_lookup_mesh` | MeSH vocabulary (tree numbers / scope notes / entry terms) |
| `pubmed_lookup_citation` | Partial citation → PMID (ECitMatch) |
| `pubmed_convert_ids` | DOI / PMID / PMCID conversion |
| `pubmed_spell_check` | Query spelling correction (ESpell) |
| `pubmed_europepmc_search` | Europe PMC search (MED/PMC/PPR/PAT/AGR, cursor paging) |
| `pubmed_europepmc_fetch` | Complete Europe PMC record (untruncated abstract) |
| `pubmed_extract_keywords` | Extract keywords from articles (MeSH weighted + NLP noun phrases/frequency, optional compromise NLP) |
| `pubmed_graph_add` | **Incrementally** add one retrieval round into the current session knowledge graph (in-memory, per-session; includes directed "X regulates/promotes/inhibits Y" relation edges) |
| `pubmed_graph_get` | Get the session / user graph (`format:'json'` nodes+edges, or `format:'mermaid'` colored flowchart card, NPG palette) |
| `pubmed_graph_commit` | **Explicitly** merge the session graph into your persistent personal user graph (not automatic) |
| `pubmed_graph_reset` | Clear the session graph (or the user graph) |

## 📦 Installation

**1. One-command install (official CLI, recommended) · no source download needed**

```bash
dsh plugin --profile web add dsh-pubmed@latest            # install from npm (published)
# or from GitHub: dsh plugin --profile web add github:aiyacharley/dsh-pubmed
# local source: dsh plugin --profile web add /path/to/dsh-pubmed
```

Then **restart DSH** — `pubmed_*` tools appear in every session.
Uninstall: `dsh plugin --profile web remove dsh-pubmed`.

**2. Paste-to-agent auto install** (needs a session on the `cordis` preset)

Paste either block below **as a whole** into a DSH session; the agent installs and self-tests:

- **Persistent · available in all sessions after restart**:

````text
[Please persistently install the dsh-pubmed plugin (available in all sessions after restart)]
1) Find the DSH profile name (e.g. web; ask if unsure).
2) Run: dsh plugin --profile <name> add dsh-pubmed@latest
3) Tell the user to restart DSH.
````

- **Session-level · takes effect immediately (local source required)**:

````text
[Please install the dsh-pubmed plugin (PubMed search, 11 tools)]
1) Locate the dsh-pubmed package directory (containing lib/pubmed-core.js). If it is not present locally, first run: git clone https://github.com/aiyacharley/dsh-pubmed.git; if you still cannot find it, ask me or search my workspace/user directory for "pubmed-core.js".
2) Read lib/dynamic-wrapper.js in that directory as the code.host for cordis_define, replacing <DSH_PUBMED_CORE_PATH> with the absolute path to lib/pubmed-core.js and <DSH_PUBMED_DIR> with the dsh-pubmed package directory.
3) Activate with cordis_run (mode=run).
4) Verify: pubmed_spell_check({query:"microbiom"}) should return corrected="microbiome"; on failure, use cordis_inspect_self to read the diagnostics and fix.
````

**3. Manual install (optional)**

- **patch**: append `- insert: [{ id: pubmed, name: 'dsh-pubmed' }]` to the profile's `cordis.patch.yml`, make sure `dsh-pubmed` is resolvable → restart.
- **session-level**: run `cordis_define` / `cordis_run` manually (template in `lib/dynamic-wrapper.js`).

## 🗑️ Uninstall

- **Session-level**: `cordis_undefine` the plugin; or simply restart the DSH process — session-level plugins are not persistent and vanish on restart.
- **Persistent** (one-command / bundle / patch): `dsh plugin --profile <name> remove dsh-pubmed` then restart; or revert the install-time changes and restart. You can also paste the block below to have the agent uninstall it:

````text
[Please uninstall the dsh-pubmed plugin (no more pubmed_* tools in any session after restart)]
1) Find the DSH profile name (e.g. web; ask if unsure).
2) Run: dsh plugin --profile <name> remove dsh-pubmed.
   If that command is unavailable, manually: remove the "dsh-pubmed" dependency (and any bundles entry) from package.json, remove the insert block with id: pubmed from cordis.patch.yml, then run npm install.
3) Tell the user to restart DSH.
````

> If the machine also has an MCP bridge for the original pubmed-mcp-server (the `mcp-pubmed` row in
> `cordis.patch.yml`), delete that row too and restart.

## 🧪 Usage examples

```
Find reviews about the gut microbiome published in 2023
→ pubmed_search_articles({ query: 'gut microbiome AND 2023[dp]', pubType: 'Review' })

Cite PMID 23193287 in APA and BibTeX
→ pubmed_format_citations({ pmids: ['23193287'], styles: ['apa', 'bibtex'] })

Resolve this DOI to a PMCID
→ pubmed_convert_ids({ ids: ['10.1093/nar/gks1195'], idtype: 'doi' })

Fetch the full text of this article
→ pubmed_fetch_fulltext({ pmids: ['23193287'] })

【Build my knowledge graph】
Round 1: pubmed_fetch_articles({ pmids: [...] }) → pubmed_graph_add({ articles: [...] })   # merge into session graph
Round 2: pubmed_fetch_articles({ pmids: [...] }) → pubmed_graph_add({ articles: [...] })   # incremental
Inspect anytime: pubmed_graph_get({ scope: 'session' })        # session graph (not auto-saved to user graph)
Add to my personal graph: pubmed_graph_commit({ confirm: true }) # explicit opt-in → persisted
Inspect personal graph: pubmed_graph_get({ scope: 'user' })
Visualize: pubmed_graph_get({ scope: 'session', format: 'mermaid', maxKeywords: 15 })  # returns mermaid code → wrap in a dsh-ui mermaid fence for a colored card
Clear: pubmed_graph_reset({ scope: 'session' })   # or scope: 'user'
```

## ⚙️ Configuration

No runtime configuration is required. Optional settings (recommended via the profile patch row
`config` — more reliable than environment variables, which may not reach the bundle depending on how
DSH is launched):

```yaml
# Your profile file, e.g. C:\Users\<you>\.dsh\profiles\<profile>\cordis.patch.yml
# Note: patch entries are PLAIN { id, config } objects — do NOT wrap with `- override:`.
- id: pubmed
  config:
    NCBI_API_KEY: '<your NCBI API key, optional>'
    AUTO_GRAPH: false        # optional: defaults to true; set false to disable auto-merge
```

| Setting | Effect |
|---|---|
| `NCBI_API_KEY` | Higher NCBI rate limit (10 req/s instead of 3 req/s); env `NCBI_API_KEY` also works |
| `AUTO_GRAPH` | **ON by default**: every `pubmed_fetch_articles` call auto-merges into the current session knowledge graph; disable with `AUTO_GRAPH: false` (or env `AUTO_GRAPH=0`) |
| `NCBI_ADMIN_EMAIL` | Contact email recommended by NCBI (env) |
| `EUROPEPMC_ENABLED` | Toggle the Europe PMC tools (env) |

Without an API key the plugin serializes requests through a global ~350 ms queue
(~2.8 req/s, under NCBI's 3 req/s); with `NCBI_API_KEY` it auto-accelerates to
~120 ms (~8 req/s, under the 10 req/s cap). Parallel calls are serialized to avoid 429s.

## ✅ Requirements

- DSH (any deployment that supports Cordis bundles)
- Node.js ≥ 20 (the bundle uses global `fetch`)
- Outbound access to `eutils.ncbi.nlm.nih.gov` and `www.ebi.ac.uk`

## 📄 License

Apache-2.0. Functionality ported from [@cyanheads/pubmed-mcp-server](https://github.com/cyanheads/pubmed-mcp-server)
(Apache-2.0, by Casey Hand).
