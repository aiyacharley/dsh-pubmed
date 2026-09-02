# dsh-pubmed

[![npm version](https://img.shields.io/npm/v/dsh-pubmed)](https://www.npmjs.com/package/dsh-pubmed)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-pubmed)

> **An "entity-level + evidence-chain" engine for literature research**: one DeepSeek Harness (DSH)
> plugin that unifies PubMed / Europe PMC / PubTator3 / Semantic Scholar — 25 native model tools,
> no MCP client, no paid proxy, pure JS with zero build step.
>
> In one sentence: **upgrade from "keyword matching" to "entity normalization + relation semantics +
> auditable evidence", turning 80% of mechanical database sifting into 20% high-quality reading time.**

---

## Table of contents

- [🚀 Install (2-minute start)](#-install-2-minute-start)
- [Why you need it](#why-you-need-it)
- [Three highlights](#three-highlights)
- [25 tools · grouped by task](#25-tools--grouped-by-task)
- [Real-world scenario scripts](#real-world-scenario-scripts)
- [Configuration](#configuration)
- [No-proxy networks (mainland-China direct)](#no-proxy-networks-mainland-china-direct)
- [Agent routing skill (auto-registered)](#agent-routing-skill-auto-registered)
- [Install & uninstall (complete)](#install--uninstall-complete)
- [Version history](#version-history)
- [Requirements](#requirements)
- [License & credits](#license--credits)

---

## 🚀 Install (2-minute start)

```bash
# One command (official CLI, recommended)
dsh plugin --profile web add dsh-pubmed@latest
# or from GitHub: dsh plugin --profile web add github:aiyacharley/dsh-pubmed
# or local source: dsh plugin --profile web add /path/to/dsh-pubmed
```

Then **restart DSH** — `pubmed_*` tools appear in every session. Sanity check:

```
pubmed_spell_check({ query: 'microbiom' })    # → corrected: "microbiome"
```

> Zero configuration required. More install options (paste-to-agent auto-install / manual patch) are at
> the bottom under [Install & uninstall (complete)](#install--uninstall-complete); uninstall lives in the same section.

---

## Why you need it

When you do literature research, you have almost certainly hit these pain points:

| Pain point | The traditional way | Result |
|---|---|---|
| **Synonym misses** | Searching `DOX` misses "doxorubicin"; `HER2` misses `ERBB2` | Half the relevant papers slip through |
| **Noise** | Keyword co-occurrence pulls in papers that merely mention the term | Only 1 in 10 hits is actually relevant |
| **Broken evidence chains** | You read "drug X treats disease Y" but cannot tell which papers support it | You hesitate to cite it |
| **No citation counts** | PubMed itself does not provide citation data | Judging impact requires third-party sites |
| **Fragmented platforms** | Bouncing between PubMed / EBI / Google Scholar, de-duplicating by hand | Time is lost on plumbing, not reading |

dsh-pubmed addresses each with **entity normalization, relation semantics, evidence lookups,
cross-source de-duplication, and direct citation data**. It does not read the literature for you —
it makes **every paper you read far more likely to be the right one**.

---

## Three highlights

### Highlight 1: Entity-level search — immune to synonym noise

PubTator3 first normalizes free text to an **authoritative concept ID** (`metformin` →
`@CHEMICAL_Metformin` → `MESH:D008687`), then a "relation query" reaches the papers that
**support a specific relationship**, instead of relying on keyword co-occurrence:

```
"What diseases does metformin treat? Show me the evidence"
→ pubmed_pubtator_entity_id({ query: 'metformin', concept: 'chemical' })   # text → canonical @ID
→ pubmed_pubtator_relations({ e1: '@CHEMICAL_Metformin', e2: 'disease', evidence: true })
      @CHEMICAL_Metformin --[treat(8423)]--> @DISEASE_Diabetes_Mellitus_Type_2
        ev: PMID 36619226, PMID 34904090, ...     ← supporting papers, directly auditable
```

Synonyms, abbreviations, casing and language differences are all absorbed by the entity ID — ask
"doxorubicin" and it finds every paper under `MESH:D004317`.

### Highlight 2: A personal literature knowledge graph — auditable, cumulative, visual

Every `pubmed_fetch_articles` call **auto-merges** into the current session graph while `AUTO_GRAPH`
is on (default) — no manual graph building:

- **Keyword nodes**: MeSH-weighted + NLP noun phrases;
- **concept nodes**: PubTator3 entities with authoritative IDs (e.g. `IgA[973]`, `human[9606]`),
  **deduplicated by ID across articles**;
- **curated relation edges**: treat / interact / ..., weight = publication-count evidence, carrying
  `evidencePmids` supporting papers by default;
- **heuristic relation edges**: stem-based "X regulates Y" (a dependency-free fallback that runs even
  when PubTator is unavailable).

```
fetch_articles (auto-merges) → incremental multi-round accumulation → graph_get({format:'mermaid'}) → graph_commit
```

When you are happy, `pubmed_graph_commit` persists everything to `~/.dsh/dsh-pubmed-graph.json`
(persists across sessions). One NPG-palette card shows: which concepts recur, which relations have
supporting literature, and which directions your review already covers.

### Highlight 3: Cross-source unified search + citation data — everything in one pass

- **`pubmed_search_papers` (cross-source unified search)**: one query over PubMed + Europe PMC,
  **deduplicated and merged** by DOI / PMID / normalized title, multi-platform hits rank first, and
  Europe PMC citation counts are merged in; `perSource` reports each platform's success/failure.
- **Five Semantic Scholar tools**: fill the three gaps the PubMed ecosystem lacks — **citation counts**
  (`get_s2_detail`), **paper recommendations** (`get_s2_recommendations`), **exact title matching**
  (`match_paper_by_title`), plus **all-field search** (`search_s2`, not biomedical-only).
  Official free API; usable without a key.

---

## 25 tools · grouped by task

> The grouping logic: **decide what you want to do first, then pick the tool from that group**.
> Tool descriptions also carry cross-references, so the agent will not mis-route.

### 🔍 Search

| Tool | What it does | When to use |
|---|---|---|
| `pubmed_search_articles` | Full PubMed keyword search (boolean / field / date syntax) | Field filters, date ranges, publication-type filters |
| `pubmed_europepmc_search` | Europe PMC search (MED/PMC/PPR/PAT/AGR, cursor paging) | PubMed too narrow (preprints / patents / non-journal) |
| `pubmed_search_papers` | **Cross-source unified search**: PubMed + Europe PMC deduped & merged | One consolidated dual-platform list without manual de-dup |
| `pubmed_pubtator_search` | PubTator3 semantic / relation search (@entity / boolean / `relations:`) | A specific bioconcept or drug/gene-disease relation is named |
| `pubmed_search_s2` | Semantic Scholar all-field search (citation counts, normalized IDs) | Cross-field search, impact info |
| `pubmed_find_related` | Grow from one known paper: similar / citing / references | Citation-network expansion |

### 📖 Full text & metadata

| Tool | What it does | When to use |
|---|---|---|
| `pubmed_fetch_articles` | Structured articles by PMID (authors / abstract / MeSH / grants / DOI / PMCID); **auto-merges** into the graph with `AUTO_GRAPH` on | Deep metadata, or feeding the knowledge graph |
| `pubmed_fetch_fulltext` | PMC full text (JATS → sectioned body; **page through** long papers with `offset`/`maxCharacters`) | 40-page papers without blowing the context window |
| `pubmed_europepmc_fetch` | Complete Europe PMC record by source+id (untruncated abstract) | Preprints / patents / non-PubMed records |

### 📝 Citations & IDs

| Tool | What it does | When to use |
|---|---|---|
| `pubmed_format_citations` | APA 7 / MLA 9 / BibTeX / RIS / Vancouver citations | Manuscript citations, journal formats |
| `pubmed_convert_ids` | DOI / PMID / PMCID conversion | You hold a DOI and need PMID/PMCID |
| `pubmed_lookup_citation` | Partial citation (journal / year / volume / pages / author) → PMID (ECitMatch) | A reference is missing its ID, or you want to trace a citation |
| `pubmed_lookup_mesh` | MeSH vocabulary (tree numbers / scope notes / entry terms) | Confirm canonical subject terms, expand synonyms |
| `pubmed_spell_check` | Query spelling correction (ESpell) | Correct your query before searching |

### 🧬 PubTator3 concept layer (semantics / relations)

| Tool | What it does | When to use |
|---|---|---|
| `pubmed_pubtator_entity_id` | Free-text bioconcept → canonical @concept ID (autocomplete) | Normalize "doxorubicin" to `@CHEMICAL_Doxorubicin` before searching |
| `pubmed_pubtator_relations` | Curated relations between concepts (treat/cause/inhibit/..., publication-count evidence; `evidence:true` attaches supporting PMIDs) | "What is the relation between X and Y?", relation-skeleton scans |
| `pubmed_pubtator_annotate` | Entity annotation (Gene/Chemical/Disease/Mutation/CellLine/Species, concept IDs; PMIDs or PMCIDs, auto-batches >100) | Dissect the entities in a paper |

### 🕸️ Knowledge graph

| Tool | What it does | When to use |
|---|---|---|
| `pubmed_graph_add` | **Incrementally** merge a round of articles into the session graph; `dryRun:true` previews without mutating | Manual feeding, or previewing what would be added |
| `pubmed_graph_get` | Get session / user graph (JSON, or NPG-palette mermaid card) | Visualize and take stock of accumulated knowledge |
| `pubmed_graph_commit` | **Explicitly** merge the session graph into the persistent user graph (not automatic) | Close out a research round as a long-term asset |
| `pubmed_graph_reset` | Clear the session (or user) graph | Start over on a new topic |

### 🌐 Semantic Scholar (citations / recommendations / match)

| Tool | What it does | When to use |
|---|---|---|
| `pubmed_get_s2_detail` | One paper's detail (citation / reference counts, OA, all IDs) | Attach a citation count to a known paper |
| `pubmed_get_s2_citations` | Papers **citing** the given paper | Trace a paper's downstream impact |
| `pubmed_get_s2_recommendations` | "Papers others read alongside this one" recommendations | Find more like a good paper |
| `pubmed_match_paper_by_title` | Exact title match → IDs / citation count / metadata | You hold the title and want to locate the paper |

---

## Real-world scenario scripts

### Scenario A: Writing a review — pull the full evidence chain for "drug X treats disease Y"

```
1. pubmed_pubtator_entity_id({ query: 'metformin', concept: 'chemical' })   # text → @CHEMICAL_Metformin
2. pubmed_pubtator_relations({ e1: '@CHEMICAL_Metformin', e2: 'disease', evidence: true })
     # relation skeleton: treat(8423)→T2DM / treat(2275)→Neoplasms / ..., each with supporting PMIDs
3. pubmed_pubtator_search({ relationType: 'treat', e1: '@CHEMICAL_Metformin', e2: 'DISEASE' })
     # relevant papers ranked + year/journal facets
4. pubmed_fetch_articles({ pmids: [...] })   # read the candidates; AUTO_GRAPH auto-merges
5. pubmed_graph_get({ scope: 'session', format: 'mermaid' })   # visualize the evidence chain
```

### Scenario B: Drug repurposing / mechanism-hypothesis scanning

```
# full spectrum of relations from one gene to all diseases
pubmed_pubtator_relations({ e1: '@GENE_TP53', e2: 'disease' })
# single-digit associations = a potentially overlooked direction → drill into evidence
pubmed_pubtator_search({ query: '@GENE_TP53 AND @DISEASE_X' })
```

### Scenario C: Novelty check for a research idea

```
# co-occurrence volume of two concepts: single-digit hits ≈ possibly an open direction
pubmed_pubtator_search({ query: '@DISEASE_COVID_19 AND @GENE_PON1' })
# cross-platform verification
pubmed_search_papers({ query: 'COVID-19 AND PON1' })
```

### Scenario D: Systematic literature management — accumulate, visualize, persist

```
pubmed_fetch_articles({ pmids: [...] })        # each round auto-merges
# ... more search rounds keep merging (isolated per session) ...
pubmed_graph_get({ scope: 'session', format: 'mermaid', maxKeywords: 15 })   # stage check-in
pubmed_graph_commit({ confirm: true })         # happy → persist to your personal graph (cross-session)
pubmed_graph_get({ scope: 'user' })            # pick it up next time
```

### Scenario E: Precise citations & ID management

```
# partial citation lookup: only journal/year/volume/pages/author at hand
pubmed_lookup_citation({ citations: [{ journal: 'Nucleic Acids Res', year: '2013', volume: '41', firstPage: 'D36', authorName: 'Benson' }] })
# citation formats: APA / BibTeX in one step
pubmed_format_citations({ pmids: ['23193287'], styles: ['apa', 'bibtex'] })
# citation count + OA PDF: gauge a paper's weight
pubmed_get_s2_detail({ paperId: 'PMID:23193287' })
```

---

## Configuration

The bundle runs with **zero configuration**. Optional settings are best supplied through the profile
patch row `config` (more reliable than environment variables, which may not reach the bundle depending
on how DSH is launched):

```yaml
# Your profile file, e.g. C:\Users\<you>\.dsh\profiles\<profile>\cordis.patch.yml
# Note: patch entries are PLAIN { id, config } objects — do NOT wrap with `- override:`.
- id: pubmed
  config:
    NCBI_API_KEY: '<optional: NCBI API key>'
    # AUTO_GRAPH: false   # default true: fetch_articles auto-merges into the session graph
    # PUBTATOR: false     # default true: graph concept layer (PubTator concepts + curated relations)
    # S2_ENABLED: false   # default true: the 5 Semantic Scholar tools
    # S2_API_KEY: '<optional: free S2 key>'
    # EUTILS_BASE_URL: 'https://your-reverse-proxy/entrez/eutils'   # optional: self-hosted proxy
```

| Setting | Default | Effect |
|---|---|---|
| `NCBI_API_KEY` | none | NCBI rate limit: 10 req/s (without key ≈3 req/s) |
| `NCBI_ADMIN_EMAIL` | built-in noreply | NCBI compliance contact email |
| `AUTO_GRAPH` | `true` | `fetch_articles` auto-merges into the session graph |
| `PUBTATOR` | `true` | Graph concept layer (off = heuristic keywords/relations only) |
| `PUBTATOR_EDGE_EVIDENCE` | `true` | Curated relation edges carry supporting PMIDs |
| `PUBTATOR_RELATION_PROBE` | `3` (cap 6) | Concepts probed for relations per article |
| `PUBTATOR_RELATION_PROBE_ARTICLES` | `8` (cap 50) | Articles probed per graph merge |
| `EUROPEPMC_ENABLED` | `true` | The two Europe PMC tools |
| `S2_ENABLED` | `true` | The 5 Semantic Scholar tools |
| `S2_API_KEY` | none | Free S2 key: 1 req/s (without key: shared 100 req/5 min) |
| `EUTILS_BASE_URL` / `PUBTATOR_BASE_URL` / `EPMC_BASE_URL` | official endpoints | Self-hosted reverse-proxy endpoints to ride out regional connectivity windows |
| `SKILL_DOC` | `true` | Auto-register the agent routing skill doc at activation |

**Built-in rate limiting**: NCBI E-utilities runs on a global queue (~120 ms with key / ~350 ms without),
PubTator3 on a dedicated ~350 ms queue (official 3 req/s, independent of the API key), Semantic Scholar on
a dedicated queue (~3 s without key / ~1.1 s with key). Parallel calls are serialized automatically — no 429s.

---

## No-proxy networks (mainland-China direct)

Free direct connectivity is this plugin's identity. From v0.3.5 it stays usable **without a proxy**:

- **Auto-retry**: network-classified failures retry with exponential backoff (covering NCBI's "blackhole
  windows"); HTTP 4xx/5xx are real answers and never retried;
- **Europe PMC fallback chain**: when NCBI stays unreachable, `search_articles` / `convert_ids` /
  `find_related(cited_by/references)` switch to Europe PMC (its MED source mirrors PubMed), marked
  `[via europepmc fallback]`;
- **Actionable errors**: distinguishes "your local proxy is down" from "host unreachable" — no more bare
  `fetch failed`;
- **Self-hosted reverse proxy**: for maximum stability, point `*_BASE_URL` at your own endpoint
  (implemented in v0.4.0).

---

## Agent routing skill (auto-registered)

The bundle ships `skills/dsh-pubmed/SKILL.md`: a **25-tool routing guide** for agents (entry point by user
phrasing, the graph-chaining workflow, the four-way search boundary, rate-limit notes). **At plugin
activation it self-registers into `~/.dsh/skills/dsh-pubmed/`** (a scanned DSH skill root) — clean
installs need zero manual copying; content auto-updates on upgrade (idempotent). Disable with
`SKILL_DOC:false`.

---

## Install & uninstall (complete)

### Install

**1. One command (official CLI, recommended)**

```bash
dsh plugin --profile web add dsh-pubmed@latest
# or from GitHub: dsh plugin --profile web add github:aiyacharley/dsh-pubmed
# or local source: dsh plugin --profile web add /path/to/dsh-pubmed
```

**2. Paste-to-agent auto install** (needs a session on the `cordis` preset):

- Persistent (available in all sessions after restart):
````text
[Please persistently install the dsh-pubmed plugin (available in all sessions after restart)]
1) Find the DSH profile name (e.g. web; ask if unsure).
2) Run: dsh plugin --profile <name> add dsh-pubmed@latest
3) Tell the user to restart DSH.
````

- Session-level (takes effect immediately, local source required):
````text
[Please install the dsh-pubmed plugin (25 tools)]
1) Locate the dsh-pubmed package directory (containing lib/pubmed-core.js); if not present locally,
   first run: git clone https://github.com/aiyacharley/dsh-pubmed.git.
2) Read lib/dynamic-wrapper.js as the code.host for cordis_define, replacing the
   <DSH_PUBMED_CORE_PATH> and <DSH_PUBMED_DIR> placeholders.
3) Activate with cordis_run (mode=run).
4) Verify: pubmed_spell_check({query:"microbiom"}) should return corrected="microbiome".
````

**3. Manual (optional)**

- patch: append `- insert: [{ id: pubmed, name: 'dsh-pubmed' }]` to the profile's `cordis.patch.yml`
  → restart;
- session-level: run `cordis_define` / `cordis_run` manually (template in `lib/dynamic-wrapper.js`).

### Uninstall

- **Session-level**: `cordis_undefine` the plugin (or restart DSH — session-level plugins are not persistent);
- **Persistent**: `dsh plugin --profile <name> remove dsh-pubmed` then restart; if the machine also has an
  MCP bridge for the original pubmed-mcp-server (the `mcp-pubmed` row), delete that too and restart.
- Paste-to-agent auto uninstall:

````text
[Please uninstall the dsh-pubmed plugin (no more pubmed_* tools in any session after restart)]
1) Find the DSH profile name (e.g. web; ask if unsure).
2) Run: dsh plugin --profile <name> remove dsh-pubmed.
   If that command is unavailable, manually: remove the "dsh-pubmed" dependency (and any bundles entry)
   from package.json, remove the insert block with id: pubmed from cordis.patch.yml, then run npm install.
3) Tell the user to restart DSH.
````

> **Leftovers after uninstall**: the skill doc `~/.dsh/skills/dsh-pubmed/` remains (orphan; delete manually);
> your user-graph file `~/.dsh/dsh-pubmed-graph.json` also remains (your knowledge asset — delete if you want).

---

## Version history

- **v0.4.0** (in development) — **Ecosystem completion + configurable reverse proxy**: `pubmed_search_papers`
  cross-source unified search (deduped & merged, `perSource` report); 5 Semantic Scholar tools (citation
  counts / recommendations / title match / all-field); `fetch_fulltext` paging slices; configurable
  `EUTILS_BASE_URL` / `PUBTATOR_BASE_URL` / `EPMC_BASE_URL`; automatic npmmirror sync after publish
  (Chinese users get the new version within a minute).
- **v0.3.9** — Removed deprecated `pubmed_extract_keywords` (19 tools); README/SKILL/cordis cleanup.
- **v0.3.8** — P4 batch 2: Europe PMC network retry layer; atomic user-graph write (crash-safe); per-session
  graph write serialization; @-prefix auto-normalization; SKILL expansion; npm scripts + CI test gate.
- **v0.3.7** — P0 fix: large-scale graph building no longer times out (mergeGraph batch-prefetch cuts 200
  articles from 200+ PubTator calls to 2; probe/evidence budgets; 150 s enrichment deadline; httpGet
  timeouts actually enforced).
- **v0.3.6** — Skill doc self-registration (auto-writes to `~/.dsh/skills/` at activation, idempotent).
- **v0.3.5** — No-proxy resilience: network-classified retry + Europe PMC fallback chain + actionable errors.
- **v0.3.4** — Display parity (relation evidence lines / evidence-backed edge summary / annotate batch info);
  500-article graph stress test at 70 ms.
- **v0.3.3** — Relation evidence lookup (`evidence:true` → supporting PMIDs on edges); annotate auto-batching +
  unified session cache; type-prioritized probing; fixed self-loops / placeholder IDs / mermaid classDef;
  `graph_add({dryRun})` preview.
- **v0.3.2** — annotate accepts PMCID; routing statements in 7 tool descriptions; bundled SKILL routing skill.
- **v0.3.1** — Live acceptance; `pubtator_search` `query` made optional (convenience params usable).
- **v0.3.0** — 20th tool `pubmed_pubtator_search`: semantic / boolean / relation-form search + facets.
- **v0.2.2** — Dedicated 350 ms PubTator rate-limit queue; relation probing filters before capping.
- **v0.2.1** — PubTator3 concept layer (annotate / entity_id / relations) + graph concept nodes.
- **v0.2.0** — Personal literature knowledge-graph engine: session/user dual graphs, incremental merging,
  NPG-palette mermaid, AUTO_GRAPH, NLP keywords & relation edges.
- **v0.1.x** — Initial release: 11 PubMed tools ported from
  [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server).

> Per-commit details: [git tags](https://github.com/aiyacharley/dsh-pubmed/tags). Design docs:
> [`docs/00_roadmap.md`](docs/00_roadmap.md) (master plan),
> [`docs/01_pubtator3-plan.md`](docs/01_pubtator3-plan.md),
> [`docs/02_optimization-review.md`](docs/02_optimization-review.md).

---

## Requirements

- DSH (any deployment that supports Cordis bundles)
- Node.js ≥ 20 (the bundle uses global `fetch`)
- Outbound access to `eutils.ncbi.nlm.nih.gov`, `www.ncbi.nlm.nih.gov` (PubTator3),
  `www.ebi.ac.uk` and `api.semanticscholar.org`

---

## License & credits

Apache-2.0.

- **Origin**: initially ported from [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server)
  (Apache-2.0, by Casey Hand) — the core PubMed capabilities (search, article metadata, full text,
  citations, MeSH, ID conversion) originate from that project.
- **This plugin's own extensions** (not present upstream): the personal literature knowledge-graph engine
  (session/user dual graphs, incremental merging), the PubTator3 concept layer (typed entity nodes with
  authoritative concept IDs + curated relation edges), heuristic NLP (noun-phrase keywords + stem-based
  relation extraction), NPG-palette mermaid visualization, cross-source unified search, Semantic Scholar
  direct integration, proxy-network fallback, and the config-driven primary/fallback dual-strategy design
  are all original to this plugin.

> This plugin is therefore no longer a plain "port": the PubMed retrieval layer credits the upstream
> project, while the knowledge-graph and concept layers are independent extensions.
