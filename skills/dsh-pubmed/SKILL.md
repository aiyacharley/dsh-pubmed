---
name: dsh-pubmed
description: Routing guide for the dsh-pubmed plugin's 20 PubMed / Europe PMC / PubTator3 tools. Use when a task involves biomedical literature — searching articles, resolving bioconcepts (genes/drugs/diseases/variants), finding drug-disease or gene-disease relations with evidence, building or expanding the personal literature knowledge graph, fetching full text, or formatting citations. Tells the agent WHICH of the 20 tools to call for each phrasing and in what order.
---

# dsh-pubmed 工具路由指南（20 个工具）

## 路由口诀（按用户话术选入口）

| 用户话术特征 | 入口工具 | 理由 |
|---|---|---|
| 提到**具体生物实体**（基因/药/病/突变）+ "找文献/证据/进展" | `pubmed_pubtator_entity_id` → `pubmed_pubtator_search` | 实体归一化免疫同义词噪音；关系式可直达"支持某关系"的文章 |
| "X 和 Y 有什么**关系**"（不要文献） | `pubmed_pubtator_relations` | 全库聚合的 curated 关系边 + publications 证据数 |
| 关键词**字段限定**查询（[title]/[dp]/日期/pubType） | `pubmed_search_articles` | 唯一支持 PubMed 完整语法的工具 |
| PubMed **不够广**（预印本/专利/非期刊） | `pubmed_europepmc_search` → `pubmed_europepmc_fetch` | MED/PMC/PPR/PAT/AGR 五源 |
| 已知 PMID，要**全文/元数据/标注** | `pubmed_fetch_fulltext` / `pubmed_fetch_articles` / `pubmed_pubtator_annotate` | 各取所需；pmcids 也可直接 annotate |
| 从一篇已知文章**顺藤摸瓜**（相似/被引/参考文献） | `pubmed_find_related` | 引文网络扩张，与概念级扩图互补 |
| 引用格式（APA/BibTeX/RIS…） | `pubmed_format_citations` | — |
| DOI/PMID/PMCID 互换、残缺引文定位 | `pubmed_convert_ids` / `pubmed_lookup_citation` | — |
| 拼写纠正、MeSH 词表浏览 | `pubmed_spell_check` / `pubmed_lookup_mesh` | — |

## 建图链路（最重要的组合流）

```
entity_id（文本→@ID）→ pubtator_search（@ID/关系式→文章）→ fetch_articles → 自动入图
```

- `pubmed_fetch_articles` 在 AUTO_GRAPH 开启（默认）时**自动并入**会话图谱——不要额外手动 `graph_add`。
- `pubmed_graph_add` 内部已做关键词提取 + PubTator 概念/关系富集——**不要先调** `pubmed_extract_keywords`。
- 会话图谱累积后 `pubmed_graph_commit` 显式持久化到用户图谱（默认不自动写）。
- `pubmed_graph_get({ format:'mermaid' })` 可直接渲染为可视化卡片。

## 三类搜索工具的边界（最易误路由）

| 工具 | 本质 | 何时用 / 何时别用 |
|---|---|---|
| `pubmed_search_articles` | PubMed 关键词检索 | 要字段语法/日期/类型过滤时用；**实体+关系类问题别用它** |
| `pubmed_europepmc_search` | 跨库检索 | PubMed 覆盖不足（预印本等）时用 |
| `pubmed_pubtator_search` | 语义/关系检索 | **提到具体生物实体或药-病关系时首选**；纯关键词语法查询它不支持 |

## 限速常识

- PubTator3 官方 3 req/s：所有 pubtator 工具已走专用 350ms 队列，并发调用会被串行化（属正常，不是卡死）。
- E-utilities：有 API key ≈8 req/s，无 key ≈2.8 req/s，同样已内置队列。
