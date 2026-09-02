# dsh-pubmed

**简体中文** | [English](README_EN.md)

[![npm version](https://img.shields.io/npm/v/dsh-pubmed)](https://www.npmjs.com/package/dsh-pubmed)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-pubmed)

**PubMed / Europe PMC 文献检索 + 个人知识图谱插件 for DeepSeek Harness (DSH)**

以 [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server) 的核心 PubMed 能力
为起点，移植并大幅扩展为 DSH 原生模型工具：搜索、文章元数据、全文、引用格式化、MeSH、ID 转换之外，
新增**个人文献知识图谱**（会话/用户双图谱）、**PubTator3 概念层**（带权威概念 ID 的实体 + curated 关系）、
**跨源统一检索**（PubMed + Europe PMC 去重合并）与 **Semantic Scholar 直连**（被引数 / 论文推荐 / 标题匹配 / 全领域检索），
共 25 个工具，直接对接 NCBI E-utilities、Europe PMC REST、PubTator3 与 Semantic Scholar，无需额外的 MCP 客户端配置。

## ✨ 功能（25 个工具）

| 工具 | 说明 |
|---|---|
| `pubmed_search_articles` | PubMed 检索（完整布尔/字段/日期语法；**关键词级**——实体与关系类问题优先 `pubtator_search`） |
| `pubmed_fetch_articles` | 按 PMID 获取结构化文章（作者/摘要/MeSH/基金/DOI/PMCID；AUTO_GRAPH 默认开启时**自动并入会话图谱**，无需再 graph_add） |
| `pubmed_fetch_fulltext` | PMC 全文（JATS → 分节正文，可 `offset`/`maxCharacters` 分页续读长文，best-effort） |
| `pubmed_format_citations` | APA 7 / MLA 9 / BibTeX / RIS / Vancouver 引用 |
| `pubmed_find_related` | 相似文献 / 引用 / 参考文献（ELink + ESummary） |
| `pubmed_lookup_mesh` | MeSH 词表（树号 / 范围注释 / 入口词） |
| `pubmed_lookup_citation` | 部分引文 → PMID（ECitMatch） |
| `pubmed_convert_ids` | DOI / PMID / PMCID 互转 |
| `pubmed_spell_check` | 检索词拼写纠正（ESpell） |
| `pubmed_europepmc_search` | Europe PMC 检索（MED/PMC/PPR/PAT/AGR，游标分页；PubMed 覆盖不足时用，语义/关系查询走 `pubtator_search`） |
| `pubmed_europepmc_fetch` | Europe PMC 单条完整记录（含未截断摘要） |
| `pubmed_search_papers` | **跨源统一检索**：一次查 PubMed + Europe PMC，按 DOI/PMID/规范化标题**去重合并排序**（双平台命中排前），`perSource` 报告各源成败——适合要"一份综合列表"的宽口径扫描 |
| `pubmed_pubtator_annotate` | PubTator3 实体标注（BioC JSON，Gene/Chemical/Disease/Mutation/CellLine/Species，带概念 ID；收 **PMID 或 PMCID**（互斥，自动补 PMC 前缀）；可 `full:true` 全文；**>100 自动分批**，会话级缓存去重） |
| `pubmed_pubtator_entity_id` | 自由文本生物概念 → 概念 ID（autocomplete，如 IgA → ncbi_gene:973） |
| `pubmed_pubtator_relations` | 概念间 curated 关系（treat/cause/inhibit/...，带 publications 证据数；`evidence:true` 可为前几条关系附带**支持文献 PMIDs**） |
| `pubmed_pubtator_search` | PubTator3 **语义/关系搜索**：自由文本 / @实体 ID / 布尔组合 / `relations:类型\|实体A\|实体B`（支持分页与年份/期刊/类型 facets 统计；实体 A 可来自 entity_id，命中 PMIDs 可喂给 graph_add） |
| `pubmed_search_s2` | Semantic Scholar **全领域检索**（200M+ 论文，不限生物医学；含被引数、归一化 ID：DOI/PMID/ArXiv/CorpusId） |
| `pubmed_get_s2_detail` | 单篇 S2 详情（摘要 / 被引数 / 参考文献数；paperId 支持 S2/DOI/PMID/ArXiv/CorpusId）——快速给已知论文补被引数 |
| `pubmed_get_s2_citations` | **引用该篇的文章列表**（S2 引文图；PubMed 生态本身没有被引数据） |
| `pubmed_get_s2_recommendations` | **论文推荐**（"读了这篇还读哪些"，与 find_related 的文本相似互补） |
| `pubmed_match_paper_by_title` | **标题精确匹配** → DOI/PMID/被引数/元数据（已持有完整标题时比模糊搜索更准） |
| `pubmed_graph_add` | 把一轮检索文章**增量并入当前会话知识图谱**（内存、按会话隔离；含启发式关系边 + PubTator 概念节点与 curated 关系；关系边默认带 `evidencePmids` 证据文献，`PUBTATOR_EDGE_EVIDENCE:false` 可关；`dryRun:true` 只预览不落盘） |
| `pubmed_graph_get` | 查询会话 / 用户知识图谱（`format:'json'` 节点+边，或 `format:'mermaid'` 彩色流程图卡片，NPG 配色） |
| `pubmed_graph_commit` | **显式**把会话图谱并入持久化的个人用户图谱（默认不自动加入） |
| `pubmed_graph_reset` | 清空会话图谱（或用户图谱） |

## 📦 安装

**1. 一条命令安装（官方 CLI，推荐）· 无需下载源码**

```bash
dsh plugin --profile web add dsh-pubmed@latest              # 从 npm 安装（已发布）
# 或从 GitHub：dsh plugin --profile web add github:aiyacharley/dsh-pubmed
# 本机有源码：dsh plugin --profile web add /path/to/dsh-pubmed
```

装完**重启 DSH**，`pubmed_*` 出现在所有会话。
卸载：`dsh plugin --profile web remove dsh-pubmed`。

**2. 复制粘贴给 Agent 自动安装**（需 `cordis` 预设的会话）

把下面任一段**整段**贴到 DSH 会话，Agent 自动完成安装并自测：

- **持久化 · 重启后全会话可用**：

````text
【请帮我持久化安装 dsh-pubmed（重启后所有会话可用）】
1) 找到 DSH profile 名称（如 web；不确定就先问）。
2) 运行 dsh plugin --profile <名称> add dsh-pubmed@latest。
3) 提示用户重启 DSH。
````

- **会话级 · 当前会话立即生效（需本机有源码）**：

````text
【请帮我安装 dsh-pubmed 插件（PubMed / Europe PMC 检索 + 知识图谱 + 统一搜索 + Semantic Scholar，25 个工具）】
1) 先定位 dsh-pubmed 包目录（含 lib/pubmed-core.js）。若本机还没有，先 git clone https://github.com/aiyacharley/dsh-pubmed.git；找不到就问我。
2) 读取该目录 lib/dynamic-wrapper.js 作为 cordis_define 的 code.host，并把 <DSH_PUBMED_CORE_PATH> 替换为 lib/pubmed-core.js 的绝对路径、<DSH_PUBMED_DIR> 替换为 dsh-pubmed 包目录。
3) cordis_run 激活（mode=run）。
4) 验证：pubmed_spell_check({query:"microbiom"}) 应返回 corrected="microbiome"；失败用 cordis_inspect_self 修复。
````

**3. 手动安装（可选）**

- **patch**：profile 的 `cordis.patch.yml` 追加 `- insert: [{ id: pubmed, name: 'dsh-pubmed' }]`，确保可解析 → 重启。
- **会话级**：手动 `cordis_define` / `cordis_run`（模板见 `lib/dynamic-wrapper.js`）。

## 🗑️ 卸载

- **会话级**：对该插件执行 `cordis_undefine` 即可；或直接重启 DSH 进程——会话级插件本就不持久，重启即消失。
- **持久化**（一条命令 / bundle / patch）：`dsh plugin --profile <名称> remove dsh-pubmed` 后重启；或撤销安装时的改动并重启。也可把下面**整段**贴给 Agent 自动卸载：

````text
【请帮我卸载 dsh-pubmed（重启后所有会话不再有 pubmed_* 工具）】
1) 找到 DSH profile 名称（如 web；不确定就先问）。
2) 运行 dsh plugin --profile <名称> remove dsh-pubmed。
   若该命令不可用，则手动：从 package.json 删除 "dsh-pubmed" 依赖（及 bundles 里的条目），从 cordis.patch.yml 删除 id 为 pubmed 的 insert 块，再 npm install。
3) 提示用户重启 DSH。
````

> 若本机还配了针对原版 pubmed-mcp-server 的 MCP 桥接（`cordis.patch.yml` 里的 `mcp-pubmed` 行），
> 卸载需一并删除该行并重启。

## 🧪 用法示例

```text
# —— 基础检索与文献管理 ——
搜一下 2023 年 gut microbiome 的综述
→ pubmed_search_articles({ query: 'gut microbiome AND 2023[dp]', pubType: 'Review' })

把这篇 PMID 23193287 按 APA 和 BibTeX 给我引用
→ pubmed_format_citations({ pmids: ['23193287'], styles: ['apa', 'bibtex'] })

查这个 DOI 对应的 PMCID / 看这篇文章的全文
→ pubmed_convert_ids({ ids: ['10.1093/nar/gks1195'], idtype: 'doi' })
→ pubmed_fetch_fulltext({ pmids: ['23193287'] })

# —— PubTator 语义/关系检索：实体与关系类问题的正确入口 ——
"二甲双胍能治什么病？给我证据文献"
→ pubmed_pubtator_entity_id({ query: 'metformin', concept: 'chemical' })        # 文本 → @CHEMICAL_Metformin
→ pubmed_pubtator_search({ relationType: 'treat', e1: '@CHEMICAL_Metformin', e2: 'DISEASE' })
→ pubmed_pubtator_relations({ e1: '@CHEMICAL_Metformin', e2: 'disease', evidence: true })  # 关系骨架，每条附支持文献 PMIDs

"这两个概念之间有没有关联的文章？"
→ pubmed_pubtator_search({ query: '@DISEASE_COVID_19 AND @GENE_PON1' })         # 布尔共现

# —— 跨源统一检索（E3）：一次查 PubMed + Europe PMC，去重合并 ——
"帮我综合搜一下这个方向，双平台都查"
→ pubmed_search_papers({ query: 'gut microbiome AND metabolomics', maxResultsPerSource: 10 })

# —— Semantic Scholar（E5）：被引数 / 推荐 / 标题匹配 / 全领域 ——
"这篇文章被引了多少次？"
→ pubmed_get_s2_detail({ paperId: 'PMID:23193287' })
"有没有推荐的相关论文？"
→ pubmed_get_s2_recommendations({ paperId: 'PMID:23193287' })
"谁引用了这篇？"
→ pubmed_get_s2_citations({ paperId: 'PMID:23193287' })
"根据标题找到这篇论文的 DOI 和被引数"
→ pubmed_match_paper_by_title({ title: '...' })
"搜全领域（不限于生物医学）"
→ pubmed_search_s2({ query: '...' })

# —— 知识图谱（AUTO_GRAPH 默认开：fetch 即自动入图）——
pubmed_fetch_articles({ pmids: [...] })                   # 取文章 → 自动并入会话图谱
pubmed_graph_add({ articles: [...], dryRun: true })       # 只想预览会新增什么？不落盘
pubmed_graph_get({ scope: 'session', format: 'mermaid', maxKeywords: 15 })  # NPG 配色可视化卡片
pubmed_graph_commit({ confirm: true })                    # 满意了 → 显式持久化到个人图谱（跨会话保留）
pubmed_graph_reset({ scope: 'session' })                  # 清空重来（或 scope: 'user'）
```

## 🎯 适用场景

| 你想做什么 | 推荐入口 |
|---|---|
| 给"某药治疗某病"找**文献证据**（写综述/标书） | `entity_id` 解析 @ID → `pubtator_search` 关系式 |
| 某方向**现状速览**（研究热度走势、期刊分布） | `relations` 看关系骨架 → `search` 读文章 + `facets.year` 看年份分布 |
| **精确实体**检索（同义词/缩写歧义免疫，如 HER2≈ERBB2、IgA 基因 vs 血管炎） | `entity_id` 拿规范 @ID → `search` 实体检索 |
| **药物重定位 / 机制假设**扫描 | `relations(e1=@GENE_X, e2=DISEASE)` 看全谱关联 → `search` 钻取证据文章 |
| **检验选题新颖性**（负结果也有价值） | `search` 布尔组合 `@A AND @B`——命中个位数 = 可能是空白方向 |
| **综述/项目知识图谱**（多轮文献累积、可视化、持久化） | `fetch_articles`（自动入图）多轮 → `graph_commit` → `graph_get mermaid` |
| 从一篇文章**顺藤摸瓜**（相似/被引/参考文献） | `find_related`（引文网络，与概念级扩图互补） |
| 要**被引数 / 论文推荐 / 标题→ID 精确匹配 / 全领域检索** | S2 五工具：`get_s2_detail` / `get_s2_citations` / `get_s2_recommendations` / `match_paper_by_title` / `search_s2` |
| 宽口径**跨源综合扫描**（一份去重后的双源列表） | `search_papers`（PubMed + Europe PMC 合并） |
| 给图谱里的关系边**补审计证据** | `relations({ evidence: true })` 或直接看建图边的 `evidencePmids` |
| 引用格式 / ID 互换 / 残缺引文定位 / 全文精读 | `format_citations` / `convert_ids` / `lookup_citation` / `fetch_fulltext` |

**四类搜索怎么选**（最常见的分岔口）：

| 问题形态 | 用哪个 |
|---|---|
| 提到具体生物实体或药-病关系，要文献 | `pubtator_search`（**首选**：实体归一化 + 关系语义，同义词噪音免疫） |
| 要**一份双源去重后的综合列表** | `search_papers`（跨 PubMed + Europe PMC 合并去重） |
| 需要字段语法/日期范围/出版类型过滤 | `pubmed_search_articles`（唯一支持完整 PubMed 语法） |
| PubMed 覆盖不足（预印本/专利/非期刊） | `europepmc_search` → `europepmc_fetch` |
| 全领域 / 被引数 / 推荐 / 标题匹配 | S2 五工具 |

## ⚡ 为什么提效

核心一句话：**把科研中的"人工筛库"变成"机器预筛 + 人工裁决"**——阅读量不减，但读到的每一篇都更可能是对的。

| 杠杆 | 传统做法 | 本插件 |
|---|---|---|
| 检索精度 | 关键词共现：同义词漏检 + 无关噪音混入 | 实体归一化（DOX/Adriamycin/阿霉素 → MESH:D004317）+ 关系语义（共现≠支持关系） |
| 证据链条 | 读综述 → 手工追参考文献 → Excel 记录 | `relations` 骨架 → `evidence:true` 拿支持文献 PMIDs → 自动写入图谱边，**可审计、可复现、可累积** |
| 文献管理 | 平铺列表（Zotero/Excel），文章间关系靠脑子记 | 增量知识图谱：实体按权威 ID 去重、关系边带证据、mermaid 可视化（500 篇 70ms） |
| 流程覆盖 | PubMed / NLM / EBI 多网站来回切换 | 25 个工具在同一 agent 会话内联动，检索→全文→引用→图谱一条链 |

**证据链一条龙**（每一步都有实测数据支撑）：

```mermaid
flowchart LR
  Q["研究问题<br/>某药-某病"] --> ID["entity_id<br/>文本 → 规范@ID"]
  ID --> R["relations<br/>关系骨架 + 证据计数"]
  R --> E["evidence:true<br/>支持文献 PMIDs"]
  E --> S["search 关系式<br/>相关文章排序"]
  S --> F["fetch / fulltext<br/>精读原文"]
  F --> G["graph_add<br/>证据入图"]
  G --> A["graph_get<br/>可审计证据链"]
```

**诚实边界**：预筛与结构化不代替阅读——科学判断仍在读完原文之后；启发式关键词层有噪音（兜底层设计使然）；curated 关系来自 PubTator 模型抽取，极新文献可能滞后。它是"把 80% 的机械检索时间变成 20% 的高质量阅读时间"，不是"代替你读文献"。

## 🧬 工作流

```
检索 → 取文章 → 自动建图（AUTO_GRAPH 默认开）→ 多轮增量累积 → 可视化 → 显式 commit 持久化
```

1. **检索**：按话术四选一——实体/关系类问题走 `pubmed_pubtator_search`（先 `pubmed_pubtator_entity_id` 解析 @ID）；
   字段语法查询走 `pubmed_search_articles`；预印本等走 `pubmed_europepmc_search`；要双源综合列表走 `pubmed_search_papers`；
   全领域 / 被引数 / 推荐 / 标题匹配走 Semantic Scholar 五工具。
2. **取文章**：`pubmed_fetch_articles({pmids})` 拿结构化文章；**AUTO_GRAPH 默认开** → 自动并入会话图谱。
3. **建图**（每篇双层，`PUBTATOR` 默认开）：
   - **启发式层**（永远跑）：关键词节点（MeSH 加权 + NLP 名词短语）+ 启发式关系边（"X 调控 Y"）。
   - **PubTator 层**：concept 节点（带权威 ID，如 `IgA[973]`，按 ID 跨文章去重）+ curated 关系边（treat/interact/...，weight=publications 证据数，**默认带 `evidencePmids` 支持文献**）。
   - **兜底**：PubTator 失败 → 静默降级为纯启发式层，不中断建图。
4. **增量累积**：多轮检索不断并入（内存、按会话隔离，跨主题自动汇聚）；拿不准先 `graph_add({dryRun:true})` 预览。
5. **可视化**：`pubmed_graph_get({format:'mermaid'})` → NPG 配色卡片（红=文章 / 绿=关键词 / 深蓝=concept / 红箭头=关系）。
6. **持久化**：`pubmed_graph_commit` 显式并入用户图谱（`~/.dsh/dsh-pubmed-graph.json`，跨会话保留）。
7. **管理**：`pubmed_graph_get({scope:'user'})` 取回，`pubmed_graph_reset` 清空。

> 数据源：NCBI E-utilities（检索/元数据/MeSH/ID转换/拼写/全文）、Europe PMC REST（检索/完整记录）、PubTator3（实体标注/概念ID/curated 关系）、Semantic Scholar（被引数/推荐/标题匹配/全领域检索）。

## ⚙️ 配置

bundle 运行时无需配置即可使用。可选配置项（**推荐写进 profile 的 patch 行 `config`**，比环境变量更稳，
因为环境变量可能因 DSH 启动方式不同而读不到）：

```yaml
# 你的 profile 文件，如 C:\Users\<你>\.dsh\profiles\<profile>\cordis.patch.yml
# 注意：补丁条目是【裸对象 { id, config }】，不要用 `- override:` 包装。
- id: pubmed
  config:
    NCBI_API_KEY: '<你的 NCBI API key，可选>'
    AUTO_GRAPH: false        # 可选：默认 true（开启）；设 false 关闭自动并入会话图谱
    PUBTATOR: false          # 可选：默认 true（PubTator 概念层开启）；设 false 只走启发式关键词/关系
    S2_ENABLED: false        # 可选：默认 true（Semantic Scholar 五工具开启）；设 false 关闭
    # S2_API_KEY: '<免费 S2 key，可选>'
    # EUTILS_BASE_URL / PUBTATOR_BASE_URL / EPMC_BASE_URL：自建反代端点（可选）
```

| 配置项 | 作用 |
|---|---|
| `NCBI_API_KEY` | 提高 NCBI 限流（10 req/s 而非 3 req/s）；也可用环境变量 `NCBI_API_KEY` |
| `AUTO_GRAPH` | **默认开启（true）**：每次 `pubmed_fetch_articles` 自动并入当前会话知识图谱；想关闭设 `AUTO_GRAPH: false`（或环境变量 `AUTO_GRAPH=0`） |
| `PUBTATOR` | **默认开启（true）**：建图时自动拉 PubTator3 概念（带 ID）+ curated 关系；PubTator 不可用时自动降级回启发式；设 `PUBTATOR: false` 完全关闭概念层 |
| `NCBI_ADMIN_EMAIL` | NCBI 建议的联系邮箱（环境变量） |
| `EUROPEPMC_ENABLED` | 控制 Europe PMC 相关工具（环境变量） |
| `S2_ENABLED` | **默认开启（true）**：Semantic Scholar 五工具开关；`S2_ENABLED: false` 关闭 |
| `S2_API_KEY` | 免费 S2 key：无 key 走共享限流（100 req/5min），有 key 提速至 1 req/s |
| `EUTILS_BASE_URL` / `PUBTATOR_BASE_URL` / `EPMC_BASE_URL` | 自建反代端点（P3.8b）：把 E-utilities / PubTator3 / Europe PMC 家族指到你自己的反向代理，扛区域网络波动 |

### 🧬 概念图谱说明

- 图谱节点分三类：**文章**（红）、**关键词**（绿，启发式词频/MeSH）、**concept**（深蓝，PubTator3 实体，带权威概念 ID 如 `IgA[973]`、`human[9606]`，按 ID 跨文章去重）。
- 边：文章↔关键词/概念（共现）、启发式关系（红箭头，X 调控 Y）、curated 概念关系（红箭头，treat/cause/interact...，带 publications 证据数与 `evidencePmids` 支持文献）。
- `pubmed_graph_get({ format:'mermaid' })` 生成 NPG 配色的卡片；PubTator 主路径 + 启发式兜底，任何失败不中断建图。

无 API key 时插件内置**全局 ~350ms 请求队列**（≈2.8 req/s，低于 NCBI 3 req/s）；配置 `NCBI_API_KEY`
后 E-utilities 队列自动提速至 **~120ms（≈8 req/s，低于 10 req/s 上限）**。并行调用也会串行化，避免 429。
PubTator3 走**独立的 ~350ms 专用队列**（其官方限额为 3 req/s，与 NCBI API key 无关），不会随 API key 提速。
Semantic Scholar 走**独立的专用队列**：无 key ≈3s/次（低于共享 100 req/5min），配免费 `S2_API_KEY` 提速至 ~1.1s/次（1 req/s）。

## 🌐 无代理网络（大陆直连）

很多用户没有代理——v0.3.5 起插件的韧性设计保证**无代理时依然可用**：

- **自动重试**：NCBI 前端在 Google Cloud 上，大陆直连存在分钟级"黑洞窗口"（时通时断）。网络类失败自动按 1s/3s 退避重试，瞬时窗口无感恢复；HTTP 4xx/5xx 视为真实答案不重试。
- **Europe PMC 自动降级**：NCBI 持续不可达时，`search_articles`、`convert_ids`、`find_related(cited_by/references)` 自动切换 **Europe PMC（其 MED 源即 PubMed 本体）**，结果带 `[via europepmc fallback]` 标记与说明。
- **能力矩阵（无代理）**：
  - ✅ 全功能：Europe PMC 双工具；PubTator 三工具与 search（直连窗口期）；search / convert_ids / find_related（重试 + 降级双保险）
  - ⚠️ 受限：`find_related similar`（EBI 无对等接口，报错说明）、`spell_check`、`lookup_mesh`（NCBI 独有，报错含可行动提示）
- **可行动报错**：网络失败自动区分"本地代理已挂"（提示清理 `HTTPS_PROXY`）与"目标不可达"（建议重试 / 降级 / 配代理），不再抛裸 `fetch failed`。
- **实测（09-01，无代理直连）**：**18/18 工具全通过**（直连窗口期 20/20 全可用）——双源检索、DOI 回路、cited_by 引文网络、4 万字符全文、跨工具缓存命中（`cacheHits: 1` 零网络复用）、`evidencePmids` 证据边、dryRun 预览均正常。
- 想要 100% 稳定仍推荐开代理；自建反代用户可配 `EUTILS_BASE_URL` / `PUBTATOR_BASE_URL` / `EPMC_BASE_URL`（v0.4.0 已实现）。

## 🧭 Agent 路由技能（跨会话，自动注册）

随包附带 `skills/dsh-pubmed/SKILL.md`：一份给 agent 看的 25 工具路由指南（按话术选入口、
建图链路组合流、四类搜索边界、限速常识）。**插件激活时自动把它注册到 `~/.dsh/skills/dsh-pubmed/`**
（被 DSH 扫描的技能 root）——纯净安装零手工，新会话的 agent 无需阅读本文档即可正确调度
多套检索、S2 与建图工具。

- 内容随版本升级自动改写（幂等，仅内容变化时写入）
- 关闭：patch config `SKILL_DOC: false`（或环境变量 `SKILL_DOC=0`）
- 卸载插件后技能文件保留（孤儿文件，可手动删除）
- 动态模式（`lib/dynamic-wrapper.js` 沙箱无 fs 写入）仍需手动拷贝到技能目录

## 📜 版本历史

- **v0.4.0**（开发中，未发布）— **生态补全 + 反代可配**：`pubmed_search_papers` 跨源统一检索（PubMed + Europe PMC 去重合并排序，`perSource` 报告）；Semantic Scholar 五工具（`search_s2` / `get_s2_detail` / `get_s2_citations` / `get_s2_recommendations` / `match_paper_by_title`，补被引数/推荐/标题匹配/全领域检索）；`fetch_fulltext` 分页切片（`offset`/`maxCharacters`/`nextOffset`）；`EUTILS_BASE_URL`/`PUBTATOR_BASE_URL`/`EPMC_BASE_URL` 反代可配；发布后自动同步 npmmirror（国内 1 分钟内可装新版）。
- **v0.3.9**（09-01）— **移除已废弃的 `pubmed_extract_keywords`**（19 工具；关键词预览用 `graph_add({dryRun:true})`）；README/SKILL/cordis 同步清理。
- **v0.3.8**（09-01）— **P4 批次二**：Europe PMC 调用套网络重试层；用户图谱原子写（tmp+rename，防崩溃损坏）；图写入按会话串行化（并发 graph_add / AUTO_GRAPH / commit 不再交错）；search/relations 实体参数 @ 前缀自动归一化；SKILL.md 扩充（工具速查表 + 配置项表 + 易错点清单）；npm scripts（`npm test`）+ Release workflow 测试门；无代理实测：并发 graph_add 串行无交错、EPM/search 双通。
- **v0.3.7**（09-01）— **P0 修复：大规模建图不再超时**：mergeGraph 批量预取（200 篇从 200+ 次 PubTator 调用降到 2 次）+ 探测/证据预算（默认 8 篇/次合并，可配置）+ 富集 150s 死线优雅截断 + `httpGet` 超时真正生效（graph_add 180s / fetch_articles 120s）；修复预取失败污染会话缓存；无代理实测 **18/18 通过**。
- **v0.3.6**（09-01）— **技能文档自注册**：插件激活时自动把 SKILL.md 写入 `~/.dsh/skills/dsh-pubmed/`（DSH 扫描的技能 root）——纯净安装零手工，升级幂等改写，`SKILL_DOC:false` 可关；Release workflow 修复（secrets-in-if 解析失败 → shell 守卫）。
- **v0.3.5**（09-01）— **无代理韧性**：网络类失败自动退避重试（1s/3s）+ EBI 降级链（`search_articles` / `convert_ids` / `find_related(cited_by/references)` 自动切 Europe PMC，带 `[via europepmc fallback]` 标记）+ 可行动报错（自动区分"本地代理已挂"vs"目标不可达"）；无代理可用工具 **2/20 → ~13/20**（黑洞窗口期底线；直连窗口期实测 **18/18 全通过**）。
- **v0.3.4**（09-01）— 显示层补齐：`relations` 的 `ev:` 证据行、`graph_get` 的 evidence-backed edges 汇总、`annotate` 的 `[batches/cacheHits]`；图谱引擎离线压测脚本入库（500 篇 70ms）。
- **v0.3.3**（09-01）— **关系证据回查**：`relations({evidence:true})` 附支持文献 PMIDs，建图 curated 边默认带 `evidencePmids`（可关）；annotate 自动分批（>100）+ 会话级缓存统一；建图探测类型优先（Disease>Chemical>Gene，可配置）；修复自环边 / 占位 ID / mermaid classDef；`graph_add({dryRun})` 预览（`extract_keywords` 废弃）；nlp.js 懒加载降级。
- **v0.3.2**（09-01）— `annotate` 支持 **PMCID**（pmc_export，自动补前缀）；7 个工具描述加路由语句；随包 `SKILL.md` agent 路由技能。
- **v0.3.1**（08-31）— 真机验收：关系搜索→建图闭环 + 限速抽查通过；热修 `pubtator_search` 的 `query` 改为可选（便捷参数真正可用）。
- **v0.3.0**（08-31）— **第 20 个工具 `pubmed_pubtator_search`**：语义 / 布尔 / 关系式文献检索（分页 + 年份/期刊/类型 facets），打通"实体→关系→证据文章→建图"闭环。
- **v0.2.2**（08-31）— 两项正确性修复：PubTator 独立 350ms 限流队列（不受 NCBI API key 提速影响）；关系探测先过滤后截断（hub 概念文内边不再丢失）。
- **v0.2.1**（08-28）— **PubTator3 概念层**：`annotate` / `entity_id` / `relations` 三工具（19 工具），建图新增 concept 节点（权威 ID 跨文章去重）+ curated 关系边；`PUBTATOR` 开关 + 静默降级。
- **v0.2.0**（08-28）— **个人文献知识图谱引擎**：会话/用户双图谱、增量合并、mermaid NPG 配色可视化；`AUTO_GRAPH` 自动入图；NLP 关键词与 directed 关系边（compromise）；`NCBI_API_KEY` + 自适应限速；patch 行 config 注入。
- **v0.1.x**（08-27）— 初版：自 [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server) 移植的 11 个 PubMed 工具（检索 / 元数据 / 全文 / 引用 / MeSH / ID 转换 / 拼写 / Europe PMC）。

> 逐版提交细节见 [git tags](https://github.com/aiyacharley/dsh-pubmed/tags)；PubTator3 增强计划全文见 [`docs/01_pubtator3-plan.md`](docs/01_pubtator3-plan.md)。

## ✅ 要求

- DSH 版本（任意支持 Cordis bundle 的部署）
- Node.js ≥ 20（bundle 使用全局 `fetch`）
- 出网可访问 `eutils.ncbi.nlm.nih.gov`、`www.ncbi.nlm.nih.gov`（PubTator3）、`www.ebi.ac.uk` 与 `api.semanticscholar.org`

## 📄 License

Apache-2.0。

- **来源**：最初移植自 [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server)
  （Apache-2.0，作者 Casey Hand）——检索、文章元数据、全文、引用、MeSH、ID 转换等核心 PubMed 能力源于该项目。
- **本插件的扩展**（原项目没有的能力）：个人文献知识图谱引擎（会话/用户双图谱、增量合并）、
  PubTator3 概念层（带权威概念 ID 的实体节点 + curated 关系边）、启发式 NLP（名词短语关键词 +
  词干关系抽取）、NPG 配色 mermaid 可视化、代理网络兜底、配置驱动的双策略（主路径+兜底）等，
  均为本插件原创设计实现。

> 因此本插件不再是单纯的"移植版"：PubMed 检索层致敬原项目，知识图谱与概念层为独立扩展。
