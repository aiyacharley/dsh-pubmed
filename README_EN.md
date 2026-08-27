# dsh-pubmed

[![npm version](https://img.shields.io/npm/v/dsh-pubmed)](https://www.npmjs.com/package/dsh-pubmed)

**PubMed / Europe PMC literature search plugin for DeepSeek Harness (DSH)**

Ports the core capabilities of [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server)
into native DSH model tools: search, article metadata, full text, citation formatting, MeSH and ID
conversion — 11 tools in total, talking directly to NCBI E-utilities and the Europe PMC REST API.
No MCP client configuration required.

## ✨ Features (11 tools)

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
```

## ⚙️ Configuration

No runtime configuration required. Optional environment variables (set in the profile patch row's
`config.env` or the process environment):

| Variable | Effect |
|---|---|
| `NCBI_API_KEY` | Higher NCBI rate limit (10 req/s instead of 3 req/s) |
| `NCBI_ADMIN_EMAIL` | Contact email recommended by NCBI |
| `EUROPEPMC_ENABLED` | Toggle the Europe PMC tools |

Without an API key the plugin paces requests at ~350 ms to avoid NCBI 429s.

## ✅ Requirements

- DSH (any deployment that supports Cordis bundles)
- Node.js ≥ 20 (the bundle uses global `fetch`)
- Outbound access to `eutils.ncbi.nlm.nih.gov` and `www.ebi.ac.uk`

## 📄 License

Apache-2.0. Functionality ported from [@cyanheads/pubmed-mcp-server](https://github.com/cyanheads/pubmed-mcp-server)
(Apache-2.0, by Casey Hand).
