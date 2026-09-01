# dsh-pubmed

[![npm version](https://img.shields.io/npm/v/dsh-pubmed)](https://www.npmjs.com/package/dsh-pubmed)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-pubmed)

**PubMed / Europe PMC literature search + personal knowledge graph plugin for DeepSeek Harness (DSH)**

Starting from the core PubMed capabilities of [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server)
and substantially extended into native DSH model tools: beyond search, article metadata, full text, citation
formatting, MeSH and ID conversion, it adds a **personal literature knowledge graph** (session/user dual graphs)
and a **PubTator3 concept layer** (typed entities with authoritative IDs + curated relations) — 20 tools in
total, talking directly to NCBI E-utilities, Europe PMC REST and PubTator3. No MCP client configuration required.

## ✨ Features (20 tools)

| Tool | Description |
|---|---|
| `pubmed_search_articles` | Full PubMed search (boolean / field / date syntax; **keyword-level** — prefer `pubtator_search` for entity & relation questions) |
| `pubmed_fetch_articles` | Structured articles by PMID (authors / abstract / MeSH / grants / DOI / PMCID; with AUTO_GRAPH on by default results **auto-merge into the session graph** — no separate graph_add) |
| `pubmed_fetch_fulltext` | PMC full text (JATS → sectioned body, best-effort) |
| `pubmed_format_citations` | APA 7 / MLA 9 / BibTeX / RIS / Vancouver citations |
| `pubmed_find_related` | Similar / citing / references (ELink + ESummary) |
| `pubmed_lookup_mesh` | MeSH vocabulary (tree numbers / scope notes / entry terms) |
| `pubmed_lookup_citation` | Partial citation → PMID (ECitMatch) |
| `pubmed_convert_ids` | DOI / PMID / PMCID conversion |
| `pubmed_spell_check` | Query spelling correction (ESpell) |
| `pubmed_europepmc_search` | Europe PMC search (MED/PMC/PPR/PAT/AGR, cursor paging; use when PubMed is too narrow — semantic/relation queries go to `pubtator_search`) |
| `pubmed_europepmc_fetch` | Complete Europe PMC record (untruncated abstract) |
| `pubmed_pubtator_annotate` | PubTator3 entity annotations (BioC JSON; Gene/Chemical/Disease/Mutation/CellLine/Species with concept IDs; accepts **PMIDs or PMCIDs** (mutually exclusive, PMC prefix normalized); `full:true` for full text; **auto-batches >100 ids**, session-cached) |
| `pubmed_pubtator_entity_id` | Resolve a free-text bioconcept to concept IDs (autocomplete; e.g. IgA → ncbi_gene:973) |
| `pubmed_pubtator_relations` | Curated bio-relations between concepts (treat/cause/inhibit/... with publication-count evidence; `evidence:true` attaches **supporting article PMIDs** to the first relations) |
| `pubmed_pubtator_search` | PubTator3 **semantic / relation search**: free text / @entity IDs / boolean combos / `relations:type\|entityA\|entityB` (paginated, with year/journal/type facet stats; resolve @IDs via entity_id, feed hits into graph_add) |
| `pubmed_extract_keywords` | ⚠️ **DEPRECATED** — use `pubmed_graph_add({ dryRun: true })` to preview extraction (removed in a future release) |
| `pubmed_graph_add` | **Incrementally** add one retrieval round into the current session knowledge graph (in-memory, per-session; heuristic relation edges + PubTator concept nodes & curated relations; curated edges carry `evidencePmids` by default — `PUBTATOR_EDGE_EVIDENCE:false` to disable; `dryRun:true` previews without mutating) |
| `pubmed_graph_get` | Get the session / user graph (`format:'json'` nodes+edges, or `format:'mermaid'` colored flowchart card, NPG palette) |
| `pubmed_graph_commit` | **Explicitly** merge the session graph into your persistent personal user graph (not automatic) |
| `pubmed_graph_reset` | Clear the session graph (or the user graph) |

## 🌐 No-proxy networks (mainland-China direct)

Many users have no proxy — from v0.3.5 the plugin's resilience design keeps it **usable without one**:

- **Auto-retry**: NCBI's frontend runs on Google Cloud; direct connectivity from mainland China fluctuates in minute-scale "blackhole windows". Network-classified failures retry automatically with 1s/3s backoff — transient windows recover invisibly. HTTP 4xx/5xx are treated as real answers and never retried.
- **Europe PMC automatic fallback**: when NCBI stays unreachable, `search_articles`, `convert_ids`, and `find_related(cited_by/references)` switch to **Europe PMC (its MED source mirrors PubMed)**, marked with `[via europepmc fallback]`.
- **Capability matrix (no proxy)**:
  - ✅ Full: both Europe PMC tools; PubTator tools & search during open windows; search / convert_ids / find_related (retry + fallback double cover)
  - ⚠️ Limited: `find_related similar` (no EPM equivalent — explained in the error), `spell_check`, `lookup_mesh` (NCBI-only; errors carry actionable hints)
- **Actionable errors**: network failures distinguish "your local proxy is down" (clean up `HTTPS_PROXY`) from "host unreachable" (retry / fallback / use a proxy) — no more bare `fetch failed`.
- For 100% stability a proxy is still recommended; self-hosted reverse-proxy users can look forward to `BASE_URL` configuration in v0.4.0 (planned).

## 🧭 Agent routing skill (cross-session)

The bundle ships `skills/dsh-pubmed/SKILL.md`: a 20-tool routing guide for agents
(entry point by user phrasing, graph-chaining workflow, the three-way search
boundary, rate-limit notes). Install it into the DSH skills directory (e.g.
`~/.agents/skills/dsh-pubmed/SKILL.md`) and **fresh sessions** can dispatch the
three search families and the graph workflow correctly without reading this README.

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
[Please install the dsh-pubmed plugin (PubMed / Europe PMC search + knowledge graph, 20 tools)]
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

```text
# —— Basic retrieval & literature management ——
Find reviews about the gut microbiome published in 2023
→ pubmed_search_articles({ query: 'gut microbiome AND 2023[dp]', pubType: 'Review' })

Cite PMID 23193287 in APA and BibTeX
→ pubmed_format_citations({ pmids: ['23193287'], styles: ['apa', 'bibtex'] })

Resolve this DOI to a PMCID / fetch the full text
→ pubmed_convert_ids({ ids: ['10.1093/nar/gks1195'], idtype: 'doi' })
→ pubmed_fetch_fulltext({ pmids: ['23193287'] })

# —— PubTator semantic / relation search: the right entry for entity & relation questions ——
"What can metformin treat? Show me the evidence"
→ pubmed_pubtator_entity_id({ query: 'metformin', concept: 'chemical' })         # text → @CHEMICAL_Metformin
→ pubmed_pubtator_search({ relationType: 'treat', e1: '@CHEMICAL_Metformin', e2: 'DISEASE' })
→ pubmed_pubtator_relations({ e1: '@CHEMICAL_Metformin', e2: 'disease', evidence: true })  # relation skeleton + supporting PMIDs

"Any articles connecting these two concepts?"
→ pubmed_pubtator_search({ query: '@DISEASE_COVID_19 AND @GENE_PON1' })          # boolean co-occurrence

# —— Knowledge graph (AUTO_GRAPH on by default: fetching auto-merges) ——
pubmed_fetch_articles({ pmids: [...] })                    # fetch → auto-merge into the session graph
pubmed_graph_add({ articles: [...], dryRun: true })        # preview what WOULD be added — no mutation
pubmed_graph_get({ scope: 'session', format: 'mermaid', maxKeywords: 15 })  # NPG-palette visual card
pubmed_graph_commit({ confirm: true })                     # happy? → persist to your personal graph
pubmed_graph_reset({ scope: 'session' })                   # start over (or scope: 'user')
```

## 🎯 When to use what

| You want to… | Entry point |
|---|---|
| Find **literature evidence** for "drug X treats disease Y" (reviews/grants) | `entity_id` → `pubtator_search` relation query |
| **Survey a field** (trend by year, journal distribution) | `relations` for the skeleton → `search` articles + `facets.year` |
| **Precise entity** search (synonym/abbreviation-immune: HER2≈ERBB2, IgA gene vs vasculitis) | `entity_id` for the canonical @ID → `search` |
| **Drug repurposing / mechanism hypothesis** scanning | `relations(e1=@GENE_X, e2=DISEASE)` full spectrum → `search` to drill in |
| **Novelty check** on an idea (negative results are informative) | `search` boolean `@A AND @B` — single-digit hits = potentially open direction |
| **Review/project knowledge graph** (multi-round accumulation, visualize, persist) | `fetch_articles` (auto-merges) → `graph_commit` → `graph_get mermaid` |
| Expand **from one known article** (similar/citing/references) | `find_related` (citation network, complements concept-based expansion) |
| Add an **audit trail** to graph relation edges | `relations({ evidence: true })` or read `evidencePmids` on built edges |
| Citations / ID conversion / fuzzy reference lookup / full-text reading | `format_citations` / `convert_ids` / `lookup_citation` / `fetch_fulltext` |

**Choosing between the three searches** (the most common fork):

| Question shape | Use |
|---|---|
| Names a specific bioconcept or a drug/gene-disease relation, wants articles | `pubtator_search` (**preferred**: entity-normalized + relation-aware, synonym-immune) |
| Needs field syntax / date ranges / publication-type filters | `pubmed_search_articles` (the only tool with full PubMed syntax) |
| PubMed coverage too narrow (preprints/patents/non-journal) | `europepmc_search` → `europepmc_fetch` |

## ⚡ Why it saves time

In one sentence: **it turns manual database sifting into machine pre-screening + human judgment** — you read no less, but everything you read is far more likely to be relevant.

| Lever | Traditional | This plugin |
|---|---|---|
| Search precision | Keyword co-occurrence: synonym misses + irrelevant noise | Entity normalization (DOX/Adriamycin → MESH:D004317) + relation semantics (co-occurrence ≠ supporting a relation) |
| Evidence chains | Read reviews → chase references by hand → track in Excel | `relations` skeleton → `evidence:true` for supporting PMIDs → auto-written onto graph edges — **auditable, reproducible, cumulative** |
| Literature management | Flat lists (Zotero/Excel); relations live in your head | Incremental knowledge graph: entities deduped by authoritative ID, evidence-carrying edges, mermaid visualization (500 articles in 70 ms) |
| Workflow coverage | Switching between PubMed / NLM / EBI | 20 tools chained inside one agent session: search → full text → citations → graph |

**The evidence chain, end to end** (every step has live-tested data behind it):

```mermaid
flowchart LR
  Q["Research question<br/>drug-disease"] --> ID["entity_id<br/>text → canonical @ID"]
  ID --> R["relations<br/>skeleton + evidence counts"]
  R --> E["evidence:true<br/>supporting PMIDs"]
  E --> S["relation search<br/>ranked articles"]
  S --> F["fetch / fulltext<br/>read the source"]
  F --> G["graph_add<br/>evidence into the graph"]
  G --> A["graph_get<br/>auditable chain"]
```

**Honest boundaries**: pre-screening and structuring do not replace reading — the scientific judgment happens after you read the source; the heuristic keyword layer is noisy (by design, it is the fallback); curated relations come from PubTator models and may lag brand-new literature. It converts 80% of mechanical retrieval time into 20% high-quality reading time — it does not read the literature for you.

## 🧬 Workflow

```
search → fetch articles → auto-graph (AUTO_GRAPH on by default) → incremental multi-round
→ visualize → explicit commit for persistence
```

1. **Search**: pick by phrasing — entity/relation questions go through `pubmed_pubtator_search` (resolve @IDs first via `pubmed_pubtator_entity_id`); field-syntax queries via `pubmed_search_articles`; preprints etc. via `pubmed_europepmc_search`.
2. **Fetch**: `pubmed_fetch_articles({pmids})` for structured articles; **AUTO_GRAPH is ON by default** → auto-merges into the session graph.
3. **Build** (two layers per article, `PUBTATOR` on by default):
   - **Heuristic layer** (always runs): keyword nodes (MeSH weighted + NLP noun phrases) + heuristic relation edges ("X regulates Y").
   - **PubTator layer**: concept nodes with authoritative IDs (e.g. `IgA[973]`, deduplicated by ID across articles) + curated relation edges (treat/interact/..., weight = publication-count evidence, **carrying `evidencePmids` supporting articles by default**).
   - **Fallback**: if PubTator fails, it silently degrades to the heuristic layer — graph building never breaks.
4. **Incremental accumulation**: more retrieval rounds keep merging (in-memory, per-session; shared concepts/keywords across topics converge automatically); unsure? preview first with `graph_add({dryRun:true})`.
5. **Visualize**: `pubmed_graph_get({format:'mermaid'})` → NPG-palette card (red=articles / green=keywords / deep-blue=concepts / red arrows=relations).
6. **Persist**: `pubmed_graph_commit` explicitly merges into your personal user graph (`~/.dsh/dsh-pubmed-graph.json`, persists across sessions).
7. **Manage**: `pubmed_graph_get({scope:'user'})` to retrieve, `pubmed_graph_reset` to clear.

> Data sources: NCBI E-utilities (search/metadata/MeSH/ID conversion/spell-check/full text), Europe PMC REST (search/full records), PubTator3 (entity annotations / concept IDs / curated relations).

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
    PUBTATOR: false          # optional: defaults to true (PubTator concept layer); set false for heuristic-only
```

| Setting | Effect |
|---|---|
| `NCBI_API_KEY` | Higher NCBI rate limit (10 req/s instead of 3 req/s); env `NCBI_API_KEY` also works |
| `AUTO_GRAPH` | **ON by default**: every `pubmed_fetch_articles` call auto-merges into the current session knowledge graph; disable with `AUTO_GRAPH: false` (or env `AUTO_GRAPH=0`) |
| `PUBTATOR` | **ON by default**: graph building auto-fetches PubTator3 concepts (with IDs) + curated relations; falls back to heuristic NLP when PubTator is unavailable; set `PUBTATOR: false` to fully disable the concept layer |
| `NCBI_ADMIN_EMAIL` | Contact email recommended by NCBI (env) |
| `EUROPEPMC_ENABLED` | Toggle the Europe PMC tools (env) |

### 🧬 Concept-graph notes

- Nodes come in three kinds: **articles** (red), **keywords** (green, heuristic/MeSH), **concepts** (deep blue, PubTator3 entities with authoritative IDs such as `IgA[973]`, `human[9606]`, deduplicated by ID across articles).
- Edges: article↔keyword/concept (co-occurrence), heuristic relations (red arrows, "X regulates Y"), curated concept relations (red arrows, treat/cause/interact/... with publication-count evidence and `evidencePmids` supporting articles).
- `pubmed_graph_get({ format:'mermaid' })` renders an NPG-palette card. PubTator is the primary path with heuristic fallback — any failure degrades gracefully without breaking graph building.

Without an API key the plugin serializes requests through a global ~350 ms queue
(~2.8 req/s, under NCBI's 3 req/s); with `NCBI_API_KEY` the E-utilities queue
auto-accelerates to ~120 ms (~8 req/s, under the 10 req/s cap). Parallel calls are serialized to avoid 429s.
PubTator3 runs on its **own dedicated ~350 ms queue** (its official limit is 3 req/s, independent of any NCBI API key).

## 📜 Version history

- **v0.3.4** (09-01) — Display parity: `ev:` evidence lines in `relations`, evidence-backed-edges summary in `graph_get`, `[batches/cacheHits]` in `annotate`; offline graph-engine stress script (500 articles in 70 ms).
- **v0.3.3** (09-01) — **Relation evidence lookup**: `relations({evidence:true})` attaches supporting article PMIDs; built curated edges carry `evidencePmids` by default (configurable); annotate auto-batching (>100) + unified session cache; type-prioritized relation probing (Disease>Chemical>Gene, configurable); fixed self-loop edges / placeholder IDs / mermaid classDef; `graph_add({dryRun})` preview (`extract_keywords` deprecated); lazy-loaded nlp.js.
- **v0.3.2** (09-01) — `annotate` accepts **PMCIDs** (pmc_export, prefix normalized); routing statements in 7 tool descriptions; bundled `SKILL.md` agent routing skill.
- **v0.3.1** (08-31) — Live acceptance: relation-search→graph closed loop + rate-limit spot checks; hotfix making `pubtator_search`'s `query` optional (convenience params usable).
- **v0.3.0** (08-31) — **20th tool `pubmed_pubtator_search`**: semantic / boolean / relation-form literature search (pagination + year/journal/type facets), completing the "entity → relation → evidence articles → graph" loop.
- **v0.2.2** (08-31) — Two correctness fixes: dedicated 350 ms PubTator rate-limit queue (immune to NCBI API key speed-up); relation probing filters before capping (hub-concept in-article edges no longer dropped).
- **v0.2.1** (08-28) — **PubTator3 concept layer**: `annotate` / `entity_id` / `relations` (19 tools); graph gains concept nodes (authoritative IDs, deduped across articles) + curated relation edges; `PUBTATOR` switch + silent degradation.
- **v0.2.0** (08-28) — **Personal literature knowledge-graph engine**: session/user dual graphs, incremental merging, NPG-palette mermaid visualization; `AUTO_GRAPH` auto-merge; NLP keywords & directed relation edges (compromise); `NCBI_API_KEY` + adaptive pacing; config via patch row.
- **v0.1.x** (08-27) — Initial release: 11 PubMed tools ported from [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server) (search / metadata / full text / citations / MeSH / ID conversion / spell check / Europe PMC).

> Per-commit details: [git tags](https://github.com/aiyacharley/dsh-pubmed/tags); the full PubTator3 enhancement plan lives in [`docs/pubtator3-plan.md`](docs/pubtator3-plan.md).

## ✅ Requirements

- DSH (any deployment that supports Cordis bundles)
- Node.js ≥ 20 (the bundle uses global `fetch`)
- Outbound access to `eutils.ncbi.nlm.nih.gov` and `www.ebi.ac.uk`

## 📄 License

Apache-2.0.

- **Origin**: initially ported from [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server)
  (Apache-2.0, by Casey Hand) — the core PubMed capabilities (search, article metadata, full text,
  citations, MeSH, ID conversion) originate from that project.
- **This plugin's own extensions** (not present upstream): the personal literature knowledge-graph engine
  (session/user dual graphs, incremental merging), the PubTator3 concept layer (typed entity nodes with
  authoritative concept IDs + curated relation edges), heuristic NLP (noun-phrase keywords + stem-based
  relation extraction), NPG-palette mermaid visualization, proxy network fallback, and the
  config-driven primary/fallback dual-strategy design are all original to this plugin.

> This plugin is therefore no longer a plain "port": the PubMed retrieval layer credits the upstream
> project, while the knowledge-graph and concept layers are independent extensions.
