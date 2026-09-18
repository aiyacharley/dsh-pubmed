# dsh-pubmed

[![npm version](https://img.shields.io/npm/v/dsh-pubmed)](https://www.npmjs.com/package/dsh-pubmed)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-pubmed)

> **An "entity-level + evidence-chain + full-text-reachable" engine for literature research**: one DeepSeek
> Harness (DSH) plugin that unifies PubMed / Europe PMC / OpenAlex / PubTator3 / Semantic Scholar —
> **26 native model tools**, no MCP client, no paid proxy, pure JS with zero build step.
>
> Just state your need in plain language — "find papers on X and download whatever is freely available" —
> and the agent picks the right tools, chains the workflow, and puts the results in front of you.
> Results come with **abstracts, citation counts, and open-access flags**; the full text is reachable.

---

## Table of contents

- [🚀 Install (2-minute start)](#-install-2-minute-start)
- [Why you need it](#why-you-need-it)
- [Six capability modules](#six-capability-modules)
- [Real-world scenario chains](#real-world-scenario-chains)
- [Configuration](#configuration)
- [No-proxy networks (mainland-China direct)](#no-proxy-networks-mainland-china-direct)
- [For agents](#for-agents)
- [Appendix: the 26 tools at a glance](#appendix-the-26-tools-at-a-glance)
- [Install & uninstall (complete)](#install--uninstall-complete)
- [Version history](#version-history)
- [Requirements](#requirements)
- [License & credits](#license--credits)

---

## 🚀 Install (2-minute start)

**Prerequisites**: install [Node.js ≥ 20](https://nodejs.org/), then **globally install the DSH CLI** (recommended — after this the `dsh` command is available everywhere):

```bash
npm install -g @deepseek-ai/dsh
dsh web        # start the DSH web environment (or temporarily: npx @deepseek-ai/dsh web)
```

Once it's running, install the plugin with one command:

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

> Zero configuration required. More install options at the bottom under
> [Install & uninstall (complete)](#install--uninstall-complete).

---

## Why you need it

When you do literature research, you have almost certainly hit these pain points:

| Pain point | The traditional way | Result |
|---|---|---|
| **Synonym misses** | Searching `DOX` misses "doxorubicin"; `HER2` misses `ERBB2` | Half the relevant papers slip through |
| **Noise** | Keyword co-occurrence pulls in papers that merely mention the term | Only 1 in 10 hits is actually relevant |
| **Broken evidence chains** | You read "drug X treats disease Y" but cannot tell which papers support it | You hesitate to cite it |
| **Hard-to-get full text** | An OA copy exists but you hunt for the PDF site by site | Time lost on plumbing |
| **Fragmented platforms** | Bouncing between PubMed / EBI / Google Scholar, de-duplicating by hand | Fragmented, non-cumulative |

dsh-pubmed addresses each with **entity normalization, relation semantics, evidence lookups,
cross-source de-duplication, and direct OA full text**. It does not read the literature for you —
it makes **every paper you read far more likely to be the right one, and actually obtainable**.

---

## Six capability modules

> Organized by module, because most usage is **agent-driven**: you state the need in plain language and the
> agent selects and chains the tools. Each module gives: **what you say → what the agent does → what you get**.

### Module 1: Literature search — "what is out there on this topic"

**You say**: "survey gut microbiome and metabolomics", "find papers on CLDN5 and insomnia"

**The agent**: normalizes your words into authoritative concepts ("doxorubicin" = `MESH:D004317` —
immune to synonyms/abbreviations/language), queries **PubMed + Europe PMC + OpenAlex** in one pass,
merges by DOI/PMID/title into a single de-duplicated list. Every hit carries its **abstract, citation
count, and open-access flag (🟢OA)**; semantic search mode reaches papers *supporting a relation* rather
than keyword co-occurrences.

**You get**: one de-duplicated list — abstracts + citations + OA flags + multi-platform hits ranked first;
filterable by year, sortable by citations.

### Module 2: Full text — "put the paper in my hands"

**You say**: "download whatever is freely available for these papers", "what does this paper actually say"

**The agent**: prefers **PMC structured full text** (sectioned body, long papers auto-paged); if not in
PMC, it aggregates **three OA sources** (Unpaywall authoritative status + Europe PMC + OpenAlex) for PDF
links, and after your confirmation batch-downloads them locally (default `~/.dsh/dsh-pubmed-pdfs/`, or a
workspace folder). Publisher "HTML interstitials" are detected and the chain advances to the next candidate.

**You get**: quotable sectioned full text (abstract + sections), or real PDF files on disk
(filenames keyed by PMID/DOI).

### Module 3: Evidence & relations — "how are X and Y related"

**You say**: "what diseases does metformin treat? show me the evidence", "how does CLDN5 relate to
blood-brain barrier injury"

**The agent**: pulls a **relation skeleton** from PubTator3's curated cross-database network (every edge
weighted by publication count), then looks up **supporting article PMIDs** for the relations you care
about; boolean combos (`@drug AND @disease`) gauge association strength.

**You get**: relation lists (treat/cause/inhibit/..., evidence-weighted) + **supporting PMIDs per
relation** — auditable and citable.

### Module 4: Knowledge graph — "manage this project's literature for me"

**You say**: "keep track of this project's literature", "draw me a map", "save this round"

**The agent**: every retrieval round **auto-merges** into the project graph (keywords + typed concept
nodes + relation edges), accumulates across rounds, isolated per session; an **NPG-palette visual card**
anytime; one command persists it into your personal graph (survives sessions).

**You get**: one picture of concepts, evidence-backed relations and coverage — literature lists become a
cumulative knowledge asset.

### Module 5: Cross-field & impact — "beyond PubMed"

**You say**: "any preprints on this?", "how many citations does this have?", "anything similar worth reading?"

**The agent**: Europe PMC adds preprints/patents/non-journal sources; Semantic Scholar adds **citation
counts, paper recommendations, exact title matching**, and all-field search (not biomedical-only).

**You get**: wider coverage + impact data + similar-paper suggestions.

### Module 6: Citations & housekeeping — "fix my references"

**You say**: "cite this in APA and BibTeX", "what PMID does this DOI correspond to?", "this reference has
no ID — find it"

**The agent**: five citation formats in one step; DOI/PMID/PMCID conversion; partial citation
(journal/year/volume/pages/author) → PMID lookup; MeSH vocabulary and spell-check.

**You get**: paste-ready citations and accurate paper IDs.

---

## Real-world scenario chains

### Scenario 1: A full research sweep (real case: CLDN5 × insomnia)

> An actual execution record from this plugin's live testing.

```
You: "Survey research linking CLDN5, ARRB2, NPRL2 to insomnia"

① agent normalizes entities → ② semantic search finds:
   ⭐ PMID 37928369 (2023) first pilot clinical study of serum Claudin-5/ZO-1
      in insomnia patients — ZO-1 significantly elevated, correlated with
      insomnia severity (direct evidence!)

You: "which ones are freely downloadable?"
③ search results tagged 🟢OA → batch OA link lookup → 3 of 4 papers open access

You: "download them"
④ PDFs land on disk (PMID37928369.pdf, 3.4MB ✓)
⑤ the closed one continues as PMC structured text
```

**Four sentences from you, start to finish.**

### Scenario 2: Drug repurposing / mechanism scanning

```
"What diseases is TP53 related to?" → relation skeleton → "which associations are niche?"
→ single-digit hits → "find evidence for those" → semantic drill-down → graph record
```

### Scenario 3: Novelty check for a research idea

```
"Any papers linking these two concepts?" → single-digit boolean hits = possibly an open direction
→ "cross-check on both platforms" → unified search dedup → a defensible conclusion
```

---

## Configuration

The bundle runs with **zero configuration**. Optional settings are best supplied through the profile
patch row `config` (more reliable than environment variables):

```yaml
# Your profile file, e.g. C:\Users\<you>\.dsh\profiles\<profile>\cordis.patch.yml
# Note: patch entries are PLAIN { id, config } objects — do NOT wrap with `- override:`.
- id: pubmed
  config:
    NCBI_API_KEY: '<optional: NCBI API key>'
    # AUTO_GRAPH: false    # default true: retrieved papers auto-join the graph
    # PUBTATOR: false      # default true: entity concept layer
    # S2_ENABLED: false    # default true: Semantic Scholar tools
    # UNPAYWALL_EMAIL: '<optional: Unpaywall contact email>'
    # PDF_DIR: 'D:/papers' # optional: PDF download dir (default ~/.dsh/dsh-pubmed-pdfs/)
```

| Setting | Default | Effect |
|---|---|---|
| `NCBI_API_KEY` | none | NCBI rate limit (10 req/s) |
| `AUTO_GRAPH` | `true` | Retrieved papers auto-join the knowledge graph |
| `PUBTATOR` | `true` | Entity concept layer (PubTator concepts + curated relations) |
| `PUBTATOR_EDGE_EVIDENCE` | `true` | Relation edges carry supporting PMIDs |
| `PUBTATOR_RELATION_PROBE` / `_ARTICLES` | 3 / 8 | Relation probing budget |
| `EUROPEPMC_ENABLED` / `S2_ENABLED` | `true` | Module switches |
| `S2_API_KEY` | none | Semantic Scholar free key: 1 req/s (without: shared 100 req/5 min) |
| `UNPAYWALL_EMAIL` | built-in address | Unpaywall contact email (must be a real address) |
| `PDF_DIR` / `DSH_PUBMED_PDF_DIR` | `~/.dsh/dsh-pubmed-pdfs/` | PDF download directory |
| `EUTILS_BASE_URL` / `PUBTATOR_BASE_URL` / `EPMC_BASE_URL` | official endpoints | Self-hosted reverse-proxy endpoints |
| `SKILL_DOC` | `true` | Auto-register the agent routing skill |
| `RELATION_ENDPOINT_REQUIRE_KEYWORD` | `true` | Graph relation-edge semantic gate |
| `HEURISTIC_RELATIONS` | `true` | Heuristic relation layer (false = pure curated graph) |

> Rate limiting, retries and OA signature validation are built in — nothing to configure.

---

## No-proxy networks (mainland-China direct)

Free direct connectivity is this plugin's identity. Network-classified failures retry with exponential
backoff; when NCBI is unreachable, searches automatically fall back to Europe PMC (its MED source mirrors
PubMed); errors distinguish "your local proxy is down" from "host unreachable". For maximum stability,
point `*_BASE_URL` at your own reverse proxy.

---

## For agents

The bundle ships `skills/dsh-pubmed/SKILL.md` — **auto-registered at activation** into
`~/.dsh/skills/dsh-pubmed/` (a scanned DSH skill root). New sessions read it automatically: full routing
rules for the 26 tools, module-chaining workflows, the OA download workflow, and the pitfalls list.

**You never need to memorize a tool name** — describe the need in plain language. If your agent wants
the calling details, point it at the SKILL or the tool descriptions.

---

## Appendix: the 26 tools at a glance

> A complete reference list. Day-to-day you need none of this — the agent routes automatically.

**Search**: `pubmed_search_papers` (cross-source unified ⭐) · `pubmed_search_articles` (full PubMed syntax, with abstracts) · `pubmed_europepmc_search` (preprints/patents) · `pubmed_pubtator_search` (semantic/relation) · `pubmed_search_s2` (all fields) · `pubmed_find_related` (similar/citing/references)

**Full text & metadata**: `pubmed_fetch_articles` (structured articles + auto-graph) · `pubmed_fetch_fulltext` (two-tier: PMC → Europe PMC, paging) · `pubmed_fetch_pdf_oa` (OA PDF discovery + download) · `pubmed_europepmc_fetch` (full EPM record)

**Citations & IDs**: `pubmed_format_citations` (APA/MLA/BibTeX/RIS/Vancouver) · `pubmed_convert_ids` (DOI/PMID/PMCID) · `pubmed_lookup_citation` (partial citation→PMID) · `pubmed_lookup_mesh` (MeSH vocabulary) · `pubmed_spell_check` (spelling)

**PubTator3 concept layer**: `pubmed_pubtator_entity_id` (text→concept ID) · `pubmed_pubtator_relations` (curated relations + evidence) · `pubmed_pubtator_annotate` (entity annotation)

**Knowledge graph**: `pubmed_graph_add` (incremental merge: articles or batch pmids) · `pubmed_graph_get` (JSON/mermaid) · `pubmed_graph_commit` (persist) · `pubmed_graph_reset` (clear)

**Semantic Scholar**: `pubmed_get_s2_detail` (citation counts) · `pubmed_get_s2_citations` (citing papers) · `pubmed_get_s2_recommendations` (recommendations) · `pubmed_match_paper_by_title` (title match)

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
[Please install the dsh-pubmed plugin (26 tools)]
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

### Update

```bash
dsh plugin --profile web update dsh-pubmed@latest     # or @0.4.2 for a specific version
```

**Restart DSH after updating.**

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

- **Unreleased (v0.4.3)** — **Graph & pipeline enhancements**: `graph_add` accepts batch `pmids`
  (≤200, auto-fetch + enrichment); `fetch_fulltext` upgraded to a two-tier chain (PMC → Europe PMC
  fullTextXML — EPMC-only OA articles now have body text); **ID resolution cache** (negative results
  included, zero repeated lookups across the pipeline); batch-tool timeout budgets (120–180s);
  `fetch_pdf_oa` locations now carry per-source attribution + a Best-PDF line + F3 conversion echo.
- **v0.4.2** — **OA PDF discovery & download + graph denoising**: new 26th tool
  `pubmed_fetch_pdf_oa` — for a **single or batch** (≤10) DOI/PMID/PMCID it aggregates **Unpaywall +
  Europe PMC + OpenAlex** into one de-duplicated, ranked OA link list; `download:true` saves the PDFs
  locally (filenames keyed by PMID/DOI; bytes only, never parsed); **PDF signature validation** (a
  publisher HTML interstitial auto-advances the chain); **unified search results now carry OA flags**
  (zero extra requests); **graph denoising** (semantic gate + mermaid trimming + pure-curated switch);
  new `UNPAYWALL_EMAIL` setting.
- **v0.4.1** — **Unified-search upgrade**: `pubmed_search_papers` defaults to three sources (PubMed +
  Europe PMC + **OpenAlex**); `sources` accepts `'s2'`/`'all'`; `sort` and a `year` cross-source filter
  (pushed server-side); agent-facing routing completed.
- **v0.4.0** — **Ecosystem completion + configurable reverse proxy**: cross-source unified search; five
  Semantic Scholar tools; `fetch_fulltext` paging slices; BASE_URL configuration; automatic npmmirror
  sync after publish.
- **v0.3.9** — Removed deprecated `pubmed_extract_keywords`.
- **v0.3.8** — Europe PMC network retry; atomic + serialized graph writes; @-prefix normalization; SKILL
  expansion; npm scripts + CI test gate.
- **v0.3.7** — Large-scale graph building no longer times out (batch prefetch + budgets + per-tool timeouts).
- **v0.3.6** — Skill doc self-registration.
- **v0.3.5** — No-proxy resilience (retry + EPMC fallback chain + actionable errors).
- **v0.3.4** — Display parity; 500-article graph stress test at 70 ms.
- **v0.3.3** — Relation evidence lookup; annotate batching + caching; `graph_add({dryRun})` preview.
- **v0.3.2** — annotate accepts PMCID; bundled SKILL routing skill.
- **v0.3.1** — Live acceptance; `pubtator_search` query optional.
- **v0.3.0** — `pubmed_pubtator_search` semantic/relation search.
- **v0.2.2** — Dedicated PubTator rate-limit queue; probe filters before capping.
- **v0.2.1** — PubTator3 concept layer + graph concept nodes.
- **v0.2.0** — Personal literature knowledge-graph engine.
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
- **This plugin's own extensions** (not present upstream): the personal literature knowledge-graph engine,
  the PubTator3 concept layer, heuristic NLP, NPG-palette mermaid visualization, cross-source unified
  search (with OpenAlex), Semantic Scholar direct integration, OA full-text PDF discovery & download,
  no-proxy resilience, and the config-driven primary/fallback dual-strategy design are all original to
  this plugin.

> This plugin is therefore no longer a plain "port": the PubMed retrieval layer credits the upstream
> project, while the knowledge-graph, concept and unified-search layers are independent extensions.
