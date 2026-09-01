# dsh-pubmed

**简体中文** | [English](README_EN.md)

[![npm version](https://img.shields.io/npm/v/dsh-pubmed)](https://www.npmjs.com/package/dsh-pubmed)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-pubmed)

**PubMed / Europe PMC 文献检索 + 个人知识图谱插件 for DeepSeek Harness (DSH)**

以 [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server) 的核心 PubMed 能力
为起点，移植并大幅扩展为 DSH 原生模型工具：搜索、文章元数据、全文、引用格式化、MeSH、ID 转换之外，
新增**个人文献知识图谱**（会话/用户双图谱）与 **PubTator3 概念层**（带权威概念 ID 的实体 + curated 关系），
共 20 个工具，直接对接 NCBI E-utilities、Europe PMC REST 与 PubTator3，无需额外的 MCP 客户端配置。

## ✨ 功能（20 个工具）

| 工具 | 说明 |
|---|---|
| `pubmed_search_articles` | PubMed 检索（完整布尔/字段/日期语法；**关键词级**——实体与关系类问题优先 `pubtator_search`） |
| `pubmed_fetch_articles` | 按 PMID 获取结构化文章（作者/摘要/MeSH/基金/DOI/PMCID；AUTO_GRAPH 默认开启时**自动并入会话图谱**，无需再 graph_add） |
| `pubmed_fetch_fulltext` | PMC 全文（JATS → 分节正文，best-effort） |
| `pubmed_format_citations` | APA 7 / MLA 9 / BibTeX / RIS / Vancouver 引用 |
| `pubmed_find_related` | 相似文献 / 引用 / 参考文献（ELink + ESummary） |
| `pubmed_lookup_mesh` | MeSH 词表（树号 / 范围注释 / 入口词） |
| `pubmed_lookup_citation` | 部分引文 → PMID（ECitMatch） |
| `pubmed_convert_ids` | DOI / PMID / PMCID 互转 |
| `pubmed_spell_check` | 检索词拼写纠正（ESpell） |
| `pubmed_europepmc_search` | Europe PMC 检索（MED/PMC/PPR/PAT/AGR，游标分页；PubMed 覆盖不足时用，语义/关系查询走 `pubtator_search`） |
| `pubmed_europepmc_fetch` | Europe PMC 单条完整记录（含未截断摘要） |
| `pubmed_pubtator_annotate` | PubTator3 实体标注（BioC JSON，Gene/Chemical/Disease/Mutation/CellLine/Species，带概念 ID；收 **PMID 或 PMCID**（互斥，自动补 PMC 前缀）；可 `full:true` 全文；**>100 自动分批**，会话级缓存去重） |
| `pubmed_pubtator_entity_id` | 自由文本生物概念 → 概念 ID（autocomplete，如 IgA → ncbi_gene:973） |
| `pubmed_pubtator_relations` | 概念间 curated 关系（treat/cause/inhibit/...，带 publications 证据数；`evidence:true` 可为前几条关系附带**支持文献 PMIDs**） |
| `pubmed_pubtator_search` | PubTator3 **语义/关系搜索**：自由文本 / @实体 ID / 布尔组合 / `relations:类型\|实体A\|实体B`（支持分页与年份/期刊/类型 facets 统计；实体 A 可来自 entity_id，命中 PMIDs 可喂给 graph_add） |
| `pubmed_extract_keywords` | ⚠️ **已废弃**——用 `pubmed_graph_add({ dryRun: true })` 预览提取结果（下个版本移除） |
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
【请帮我安装 dsh-pubmed 插件（PubMed 检索，11 个工具）】
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

```
搜一下 2023 年 gut microbiome 的综述
→ pubmed_search_articles({ query: 'gut microbiome AND 2023[dp]', pubType: 'Review' })

把这篇 PMID 23193287 按 APA 和 BibTeX 给我引用
→ pubmed_format_citations({ pmids: ['23193287'], styles: ['apa', 'bibtex'] })

查这个 DOI 对应的 PMCID
→ pubmed_convert_ids({ ids: ['10.1093/nar/gks1195'], idtype: 'doi' })

看这篇文章的全文
→ pubmed_fetch_fulltext({ pmids: ['23193287'] })

【构建我的知识图谱】
第 1 轮：pubmed_fetch_articles({ pmids: [...] }) → pubmed_graph_add({ articles: [...] })   # 并入会话图谱
第 2 轮：pubmed_fetch_articles({ pmids: [...] }) → pubmed_graph_add({ articles: [...] })   # 增量补充
随时查看：pubmed_graph_get({ scope: 'session' })          # 会话图谱（默认不写入用户图谱）
想并入个人图谱：pubmed_graph_commit({ confirm: true })    # 显式提交 → 持久化到用户图谱
查看个人图谱：pubmed_graph_get({ scope: 'user' })
可视化：pubmed_graph_get({ scope: 'session', format: 'mermaid', maxKeywords: 15 })  # 返回 mermaid 代码 → 包进 dsh-ui mermaid 围栏即得彩色卡片
清空：pubmed_graph_reset({ scope: 'session' })  # 或 scope: 'user'
```

## 🧬 工作流

```
检索 → 取文章 → 自动建图（AUTO_GRAPH 默认开）→ 多轮增量累积 → 可视化 → 显式 commit 持久化
```

1. **检索**：`pubmed_search_articles`（NCBI）或 `pubmed_europepmc_search`（Europe PMC）。
2. **取文章**：`pubmed_fetch_articles({pmids})` 拿结构化文章；**AUTO_GRAPH 默认开** → 自动并入会话图谱。
3. **建图**（每篇双层，`PUBTATOR` 默认开）：
   - **启发式层**（永远跑）：关键词节点（MeSH 加权 + NLP 名词短语）+ 启发式关系边（"X 调控 Y"）。
   - **PubTator 层**：concept 节点（带权威 ID，如 `IgA[973]`，按 ID 跨文章去重）+ curated 关系边（treat/interact/...，weight=publications 证据）。
   - **兜底**：PubTator 失败 → 静默降级为纯启发式层，不中断建图。
4. **增量累积**：多轮检索 `pubmed_graph_add` 不断并入（内存、按会话隔离，跨主题自动汇聚）。
5. **可视化**：`pubmed_graph_get({format:'mermaid'})` → NPG 配色卡片（红=文章 / 绿=关键词 / 深蓝=concept / 红箭头=关系）。
6. **持久化**：`pubmed_graph_commit` 显式并入用户图谱（`~/.dsh/dsh-pubmed-graph.json`，跨会话保留）。
7. **管理**：`pubmed_graph_get({scope:'user'})` 取回，`pubmed_graph_reset` 清空。

> 数据源：NCBI E-utilities（检索/元数据/MeSH/ID转换/拼写/全文）、Europe PMC REST（检索/完整记录）、PubTator3（实体标注/概念ID/curated 关系）。

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
```

| 配置项 | 作用 |
|---|---|
| `NCBI_API_KEY` | 提高 NCBI 限流（10 req/s 而非 3 req/s）；也可用环境变量 `NCBI_API_KEY` |
| `AUTO_GRAPH` | **默认开启（true）**：每次 `pubmed_fetch_articles` 自动并入当前会话知识图谱；想关闭设 `AUTO_GRAPH: false`（或环境变量 `AUTO_GRAPH=0`） |
| `PUBTATOR` | **默认开启（true）**：建图时自动拉 PubTator3 概念（带 ID）+ curated 关系；PubTator 不可用时自动降级回启发式；设 `PUBTATOR: false` 完全关闭概念层 |
| `NCBI_ADMIN_EMAIL` | NCBI 建议的联系邮箱（环境变量） |
| `EUROPEPMC_ENABLED` | 控制 Europe PMC 相关工具（环境变量） |

### 🧬 概念图谱说明

- 图谱节点分三类：**文章**（红）、**关键词**（绿，启发式词频/MeSH）、**concept**（深蓝，PubTator3 实体，带权威概念 ID 如 `IgA[973]`、`human[9606]`，按 ID 跨文章去重）。
- 边：文章↔关键词/概念（共现）、启发式关系（红箭头，X 调控 Y）、curated 概念关系（红箭头，treat/cause/interact...，带 publications 证据数）。
- `pubmed_graph_get({ format:'mermaid' })` 生成 NPG 配色的卡片；PubTator 主路径 + 启发式兜底，任何失败不中断建图。

无 API key 时插件内置**全局 ~350ms 请求队列**（≈2.8 req/s，低于 NCBI 3 req/s）；配置 `NCBI_API_KEY`
后 E-utilities 队列自动提速至 **~120ms（≈8 req/s，低于 10 req/s 上限）**。并行调用也会串行化，避免 429。
PubTator3 走**独立的 ~350ms 专用队列**（其官方限额为 3 req/s，与 NCBI API key 无关），不会随 API key 提速。

## 🧭 Agent 路由技能（跨会话）

随包附带 `skills/dsh-pubmed/SKILL.md`：一份给 agent 看的 20 工具路由指南（按话术选入口、
建图链路组合流、三类搜索边界、限速常识）。把它安装到 DSH 的技能目录（如
`~/.agents/skills/dsh-pubmed/SKILL.md`）后，**新会话**的 agent 无需阅读本文档即可正确调度
三套检索与建图工具。

## ✅ 要求

- DSH 版本（任意支持 Cordis bundle 的部署）
- Node.js ≥ 20（bundle 使用全局 `fetch`）
- 出网可访问 `eutils.ncbi.nlm.nih.gov` 与 `www.ebi.ac.uk`

## 📄 License

Apache-2.0。

- **来源**：最初移植自 [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server)
  （Apache-2.0，作者 Casey Hand）——检索、文章元数据、全文、引用、MeSH、ID 转换等核心 PubMed 能力源于该项目。
- **本插件的扩展**（原项目没有的能力）：个人文献知识图谱引擎（会话/用户双图谱、增量合并）、
  PubTator3 概念层（带权威概念 ID 的实体节点 + curated 关系边）、启发式 NLP（名词短语关键词 +
  词干关系抽取）、NPG 配色 mermaid 可视化、代理网络兜底、配置驱动的双策略（主路径+兜底）等，
  均为本插件原创设计实现。

> 因此本插件不再是单纯的"移植版"：PubMed 检索层致敬原项目，知识图谱与概念层为独立扩展。
