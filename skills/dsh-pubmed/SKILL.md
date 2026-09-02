---
name: dsh-pubmed
description: Routing guide for the dsh-pubmed plugin's 25 PubMed / Europe PMC / PubTator3 / Semantic Scholar tools. Use when a task involves biomedical literature — searching articles, resolving bioconcepts (genes/drugs/diseases/variants), finding drug-disease or gene-disease relations with evidence, cross-source unified search, citation counts / paper recommendations / title matching (Semantic Scholar), building or expanding the personal literature knowledge graph, fetching full text, or formatting citations. Tells the agent WHICH of the 25 tools to call for each phrasing and in what order.
---

# dsh-pubmed 工具路由指南（25 个工具）

## 路由口诀（按用户话术选入口）

| 用户话术特征 | 入口工具 | 理由 |
|---|---|---|
| 提到**具体生物实体**（基因/药/病/突变）+ "找文献/证据/进展" | `pubmed_pubtator_entity_id` → `pubmed_pubtator_search` | 实体归一化免疫同义词噪音；关系式可直达"支持某关系"的文章 |
| "X 和 Y 有什么**关系**"（不要文献） | `pubmed_pubtator_relations` | 全库聚合的 curated 关系边 + publications 证据数；`evidence:true` 还能给前几条关系附上支持文献 PMIDs |
| **一次跨 PubMed + Europe PMC 双源**检索，要去重合并后的结果 | `pubmed_search_papers` | 双源命中排前、按 DOI/PMID/标题归一化去重；perSource 报各源成败 |
| 关键词**字段限定**查询（[title]/[dp]/日期/pubType） | `pubmed_search_articles` | 唯一支持 PubMed 完整语法的工具 |
| PubMed **不够广**（预印本/专利/非期刊） | `pubmed_europepmc_search` → `pubmed_europepmc_fetch` | MED/PMC/PPR/PAT/AGR 五源 |
| 要**被引数 / 论文推荐 / 标题→论文精确匹配**，或检索**全领域**（不限生物医学） | `pubmed_get_s2_detail` / `pubmed_get_s2_citations` / `pubmed_get_s2_recommendations` / `pubmed_match_paper_by_title` / `pubmed_search_s2` | Semantic Scholar 免费 Graph API：PubMed 生态缺的被引数据在此补全 |
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
- `pubmed_graph_add` 内部已做关键词提取 + PubTator 概念/关系富集——curated 关系边默认带 `evidencePmids` 支持文献（`PUBTATOR_EDGE_EVIDENCE:false` 可关）。关键词预览用 `graph_add({dryRun:true})`。
- 会话图谱累积后 `pubmed_graph_commit` 显式持久化到用户图谱（默认不自动写）。
- `pubmed_graph_get({ format:'mermaid' })` 可直接渲染为可视化卡片。

## 四类搜索工具的边界（最易误路由）

| 工具 | 本质 | 何时用 / 何时别用 |
|---|---|---|
| `pubmed_search_articles` | PubMed 关键词检索 | 要字段语法/日期/类型过滤时用；**实体+关系类问题别用它** |
| `pubmed_europepmc_search` | 跨库检索 | PubMed 覆盖不足（预印本等）时用 |
| `pubmed_search_papers` | 跨源统一搜索（去重合并） | 要**一份去重后的综合列表**时用；要某源特有过滤/排序/分页时用它下面的平台工具 |
| `pubmed_pubtator_search` | 语义/关系检索 | **提到具体生物实体或药-病关系时首选**；纯关键词语法查询它不支持 |

## 限速常识

- PubTator3 官方 3 req/s：所有 pubtator 工具已走专用 350ms 队列，并发调用会被串行化（属正常，不是卡死）。
- E-utilities：有 API key ≈8 req/s，无 key ≈2.8 req/s，同样已内置队列。
- Semantic Scholar：无 key 100 req/5min（共享 IP，专用 ~3s 队列）；配免费 `S2_API_KEY` 后提速至 1 req/s（~1.1s 队列）。被限流会自动重试。
- **重试与降级（v0.3.5+）**：网络类失败自动重试（指数退避）+ EBI 降级链；报错会区分"本地代理已挂"与"目标不可达"。

## 25 工具速查（输入 → 输出）

| 工具 | 输入 | 输出 |
|---|---|---|
| `pubmed_search_articles` | query（字段语法）+ 日期/类型过滤 | PMID 列表 + ESummary 摘要 |
| `pubmed_fetch_articles` | pmids（≤200） | 结构化文章（作者/摘要/MeSH/基金/DOI）|
| `pubmed_fetch_fulltext` | pmids/pmcids/dois（互斥） | 分节全文（可 offset/maxCharacters 分页续读）|
| `pubmed_format_citations` | pmids + styles | APA/MLA/BibTeX/RIS/Vancouver |
| `pubmed_find_related` | pmid + relation | 相似/被引/参考文献列表 |
| `pubmed_lookup_mesh` | query | MeSH 描述符（树号/范围/入口词）|
| `pubmed_lookup_citation` | 残缺引文（≥1 字段）| 匹配 PMID |
| `pubmed_convert_ids` | ids + idtype | 三类 ID 互转 |
| `pubmed_spell_check` | query | 纠正建议 |
| `pubmed_europepmc_search` | query + sources + pageSize | EPM 文章列表（游标分页）|
| `pubmed_europepmc_fetch` | records（source+id）| 完整 EPM 记录 |
| `pubmed_search_papers` | query + sources + maxResultsPerSource | 双源去重合并排序的文章列表 + perSource 报告 |
| `pubmed_pubtator_annotate` | pmids 或 pmcids + full | 实体标注（类型+概念 ID+位置）|
| `pubmed_pubtator_entity_id` | query + concept | 候选 @实体 ID 列表 |
| `pubmed_pubtator_relations` | e1 + type/e2 + evidence | curated 关系边（+证据 PMIDs）|
| `pubmed_pubtator_search` | query/relationType+e1+e2 + page | 排序文章 + facets |
| `pubmed_search_s2` | query + year/openAccessOnly | 全领域文章（含被引数、归一化 ID）|
| `pubmed_get_s2_detail` | paperId（S2/DOI/PMID/ArXiv/CorpusId）| 单篇详情（摘要/被引/参考文献数）|
| `pubmed_get_s2_citations` | paperId | 引用该篇的文章列表（S2 引文图）|
| `pubmed_get_s2_recommendations` | paperId | "读了这篇还读哪些"推荐列表 |
| `pubmed_match_paper_by_title` | title | 标题精确匹配 → ID/被引数/元数据 |
| `pubmed_graph_add` | articles + dryRun | 增量入图（+节点/边统计）|
| `pubmed_graph_get` | scope + format + minCount | 节点/边 JSON 或 mermaid 卡片|
| `pubmed_graph_commit` | confirm | 会话图谱 → 用户图谱持久化|
| `pubmed_graph_reset` | scope | 清空会话（或用户）图谱|

## 配置项（patch config 或环境变量）

| 配置 | 默认 | 说明 |
|---|---|---|
| `NCBI_API_KEY` | 无 | 有 key ≈8 req/s（E-utilities 队列提速）|
| `NCBI_ADMIN_EMAIL` | 内置 noreply 地址 | NCBI 合规联系邮箱 |
| `AUTO_GRAPH` | true | fetch_articles 自动入会话图谱 |
| `PUBTATOR` | true | 建图概念层（关闭只走启发式）|
| `PUBTATOR_EDGE_EVIDENCE` | true | curated 关系边附证据 PMIDs |
| `PUBTATOR_RELATION_PROBE` | 3（上限 6）| 每篇文章的关系探测概念数 |
| `PUBTATOR_RELATION_PROBE_ARTICLES` | 8（上限 50）| 每次合并的关系探测文章数 |
| `EUROPEPMC_ENABLED` | true | EPM 双工具开关 |
| `SKILL_DOC` | true | 技能文档自注册开关 |
| `EUTILS_BASE_URL` | NCBI 官方 | 自建反代（E-utilities 家族）端点，可配以扛区域网络波动 |
| `PUBTATOR_BASE_URL` | PubTator3 官方 | 同上，PubTator 家族 |
| `EPMC_BASE_URL` | EBI 官方 | 同上，Europe PMC 家族 |
| `S2_ENABLED` | true | Semantic Scholar 五工具开关 |
| `S2_API_KEY` | 无 | S2 免费 key：1 req/s（否则共享 100 req/5min）|

## 易错点（务必记住）

- **`pubmed_extract_keywords` 已废弃**——`graph_add` 内部已做提取；预览用 `graph_add({dryRun:true})`。
- **`AUTO_GRAPH` 默认开**——fetch_articles 自动入图，不要再手动 graph_add。
- **用户图谱持久化路径**：`~/.dsh/dsh-pubmed-graph.json`（graph_commit 显式写入）。
- **无代理（大陆直连）能力矩阵**：EBI 双工具全功能；PubTator/NCBI 工具随直连窗口波动（自动重试 + search/convert/find_related 有 EBI 降级）；`spell_check`/`lookup_mesh`/`similar` 为 NCBI 独有；可配 `*_BASE_URL` 自建反代兜底。
- **@实体 ID 链路**：entity_id 输出（如 `@GENE_CD79A`）→ relations/search 输入；漏 @ 会自动补齐。
- **S2 是"补充"不是"替代"**：生物医学实体/关系问题仍走 PubTator 工具；S2 补被引数、推荐、标题匹配与全领域覆盖，且无 key 时共享限流（大列表请求注意 pace）。
