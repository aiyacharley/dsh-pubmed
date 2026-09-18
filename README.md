# dsh-pubmed

**简体中文** | [English](README_EN.md)

[![npm version](https://img.shields.io/npm/v/dsh-pubmed)](https://www.npmjs.com/package/dsh-pubmed)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-pubmed)

> **给科研文献检索装上"实体级 + 证据链 + 全文可达"引擎**：PubMed / Europe PMC / OpenAlex / PubTator3 / Semantic Scholar
> 五源一体的 DeepSeek Harness（DSH）插件，**26 个原生模型工具**，无 MCP 客户端、无付费代理、纯 JS 免构建。
>
> 你只管用自然语言提需求——"帮我找 XX 的文献，能下载的下载下来"——agent 会选对工具、串起流程、把结果摆到你面前。
> 检索结果自带**摘要、被引数与开放获取标记**，全文可达。

---

## 目录

- [🚀 安装（2 分钟上手）](#-安装2-分钟上手)
- [为什么需要它](#为什么需要它)
- [六大功能模块](#六大功能模块)
- [典型场景串联](#典型场景串联)
- [配置](#配置)
- [无代理网络（大陆直连）](#无代理网络大陆直连)
- [给 Agent 的说明](#给-agent-的说明)
- [附录：26 工具速查](#附录26-工具速查)
- [安装与卸载（完整）](#安装与卸载完整)
- [版本历史](#版本历史)
- [要求](#要求)
- [License 与致谢](#license-与致谢)

---

## 🚀 安装（2 分钟上手）

**前置**：先装 [Node.js ≥ 20](https://nodejs.org/)，再**全局安装 DSH CLI**（推荐，装完直接用 `dsh` 命令）：

```bash
npm install -g @deepseek-ai/dsh
dsh web        # 启动 DSH web 环境（未全局安装也可临时用 npx @deepseek-ai/dsh web）
```

启动后，一条命令安装本插件：

```bash
# 一条命令安装（官方 CLI，推荐）
dsh plugin --profile web add dsh-pubmed@latest
# 或从 GitHub：dsh plugin --profile web add github:aiyacharley/dsh-pubmed
# 或本机源码：dsh plugin --profile web add /path/to/dsh-pubmed
```

装完**重启 DSH**，`pubmed_*` 工具出现在所有会话。自检一条：

```
pubmed_spell_check({ query: 'microbiom' })    # → corrected: "microbiome"
```

> 零配置即可用；更多安装方式见文末[安装与卸载（完整）](#安装与卸载完整)。

---

## 为什么需要它

做文献调研时，你大概率遇到过这几个痛点：

| 痛点 | 传统做法 | 结果 |
|---|---|---|
| **同义词漏检** | 搜 `DOX` 搜不到"阿霉素"、搜 `HER2` 漏掉 `ERBB2` | 漏掉一半相关文献 |
| **噪音混入** | 关键词共现把"只是顺便提到"的文章也搜进来 | 读十篇只有一篇相关 |
| **证据链断裂** | 看到"某药可治某病"却不知道哪些文献支撑 | 不敢放心引用 |
| **全文难拿** | 有 OA 副本却要挨个网站找 PDF | 时间耗在搬运上 |
| **多平台割裂** | PubMed / EBI / Google Scholar 来回切、手工去重 | 碎片化、不可累积 |

dsh-pubmed 用 **实体归一化、关系语义、证据回查、跨源去重、OA 全文直达** 逐一回应这些痛点。
它不替你读文献，而是让你**读到的每一篇都更可能是对的、且拿得到全文**。

---

## 六大功能模块

> 按模块组织，因为大多数时候你在 **agent 场景**下使用：你用自然语言说需求，agent 自动选择和串联工具。
> 每个模块给出：**你怎么说 → agent 做什么 → 你得到什么**。

### 模块一：文献检索 —— "这个方向到底有什么"

**你说**："帮我调研 gut microbiome 与代谢组学的研究"、"找 CLDN5 和失眠相关的文献"

**agent 做什么**：把你的说法归一到权威概念（"阿霉素" = `MESH:D004317`，免疫同义词/缩写/语种差异），同时查 **PubMed + Europe PMC + OpenAlex** 三个库，按 DOI/PMID/标题去重合并成一份列表。每篇自带**摘要、被引数、是否开放获取（🟢OA）**；语义检索模式直达"支持某关系"的文章，而不是关键词碰巧共现。

**你得到**：一份去重的文献列表——摘要 + 被引数 + OA 标记 + 多平台命中排最前；还能按年份过滤、按被引排序。

### 模块二：全文获取 —— "把论文拿下来读"

**你说**："把这几篇能免费下载的 PDF 下载下来"、"这篇文章全文讲了什么"

**agent 做什么**：优先取 **PMC 结构化全文**（分节正文，长文自动分页）；不在 PMC 的走 **OA 三源聚合**（Unpaywall 权威 OA 状态 + Europe PMC + OpenAlex）找 PDF 直链，经你确认后批量下载到本地（默认 `~/.dsh/dsh-pubmed-pdfs/`，也可指定工作区目录）。出版社的"HTML 拦截页"会被自动识破并跳到下一个候选链接。

**你得到**：可直接引用的分节全文（含摘要与各章节），或落在本地磁盘的真 PDF 文件（文件名用 PMID/DOI，方便辨认）。

### 模块三：证据与关系 —— "X 和 Y 有什么关系"

**你说**："二甲双胍能治什么病？给我证据文献"、"CLDN5 和血脑屏障损伤什么关系"

**agent 做什么**：用 PubTator3 的全库 curated 关系网络拉出**关系骨架**（每条带文献数），再对目标关系**回查支持文献 PMIDs**；也能做布尔组合（`@药物 AND @疾病`）检验关联强度。

**你得到**：关系列表（treat/cause/inhibit/...，每条带证据数）+ 每条关系的**支持文献 PMIDs**——可审计、可引用。

### 模块四：知识图谱 —— "帮我把课题文献管理起来"

**你说**："把这个课题的文献管理起来"、"画一张图谱看看"、"这轮先存下来"

**agent 做什么**：每轮检索的文献**自动并入**当前课题图谱（关键词 + 带权威 ID 的实体概念 + 关系边），多轮累积、按课题隔离；随时生成 **NPG 配色可视化卡片**；满意后一键持久化到个人图谱（跨会话保留）。

**你得到**：一张图看清概念脉络、关系证据、覆盖方向——从"平铺的文献列表"变成"可累积的知识资产"。

### 模块五：跨领域与影响力 —— "不止 PubMed"

**你说**："这个方向有预印本吗"、"这篇被引多少"、"有没有类似的文章推荐"

**agent 做什么**：Europe PMC 补预印本/专利/非期刊源；Semantic Scholar 补**被引数、论文推荐、标题精确匹配**和全领域检索（不限于生物医学）。

**你得到**：更宽的覆盖面 + 影响力数据 + 相似文献推荐。

### 模块六：引用与整理 —— "帮我整理引用"

**你说**："这篇按 APA 和 BibTeX 引用"、"这个 DOI 对应的 PMID 是什么"、"参考文献里这条缺 ID 帮我找"

**agent 做什么**：五种引用格式一步生成；DOI/PMID/PMCID 互转；残缺引文（期刊/年份/卷/页/作者）反查 PMID；MeSH 词表与拼写纠正。

**你得到**：可直接粘贴的引用与准确的文献 ID。

---

## 典型场景串联

### 场景一：课题调研全流程（真实案例：CLDN5 × 失眠）

> 以下是插件实测的真实执行记录。

```
你："帮我调研 CLDN5、ARRB2、NPRL2 三个基因与失眠相关的研究"

① agent 归一实体 → ② 语义检索发现：
   ⭐ PMID 37928369（2023）失眠患者血清 Claudin-5/ZO-1 水平的先导临床研究
      —— ZO-1 显著升高且与失眠严重度正相关（直接证据！）

你："哪些能免费下载？"
③ 检索结果标 🟢OA → 批量查 OA 链接 → 4 篇里 3 篇开放获取

你："下载下来"
④ PDF 落盘（PMID37928369.pdf 3.4MB ✓）
⑤ 闭源的那篇走 PMC 结构化正文继续精读
```

**全程你只说了 4 句话。**

### 场景二：药物重定位 / 机制假设扫描

```
"TP53 和哪些疾病有关系？"→ 关系骨架全谱 → "其中哪些是冷门方向？"→ 命中个位数的关联
→ "给这些方向找证据文献" → 语义检索钻取 → 图谱记录
```

### 场景三：选题新颖性检验

```
"这两个概念之间有关联文章吗？"→ 布尔检索命中个位数 = 可能是空白方向
→ "双平台交叉确认" → 统一检索去重 → 结论可信度倍增
```

---

## 配置

bundle 运行时**零配置即可用**。可选配置建议写进 profile 的 patch 行 `config`（比环境变量更稳）：

```yaml
# 你的 profile 文件，如 C:\Users\<你>\.dsh\profiles\<profile>\cordis.patch.yml
# 注意：补丁条目是【裸对象 { id, config }】，不要用 `- override:` 包装。
- id: pubmed
  config:
    NCBI_API_KEY: '<可选：NCBI API key>'
    # AUTO_GRAPH: false    # 默认 true：检索到的文献自动进知识图谱
    # PUBTATOR: false      # 默认 true：实体概念层
    # S2_ENABLED: false    # 默认 true：Semantic Scholar 工具
    # UNPAYWALL_EMAIL: '<可选：Unpaywall 联系邮箱>'
    # PDF_DIR: 'D:/papers' # 可选：PDF 下载目录（默认 ~/.dsh/dsh-pubmed-pdfs/）
```

| 配置项 | 默认 | 作用 |
|---|---|---|
| `NCBI_API_KEY` | 无 | NCBI 限流提速（10 req/s）|
| `AUTO_GRAPH` | `true` | 检索到的文献自动并入知识图谱 |
| `PUBTATOR` | `true` | 实体概念层（PubTator 概念 + curated 关系）|
| `PUBTATOR_EDGE_EVIDENCE` | `true` | 关系边附证据文献 |
| `PUBTATOR_RELATION_PROBE` / `_ARTICLES` | 3 / 8 | 关系探测预算 |
| `EUROPEPMC_ENABLED` / `S2_ENABLED` | `true` | 对应模块开关 |
| `S2_API_KEY` | 无 | Semantic Scholar 免费key：1 req/s（无 key 共享 100 req/5min）|
| `UNPAYWALL_EMAIL` | 内置地址 | Unpaywall 联系邮箱（须真实邮箱）|
| `PDF_DIR` / `DSH_PUBMED_PDF_DIR` | `~/.dsh/dsh-pubmed-pdfs/` | PDF 下载目录 |
| `EUTILS_BASE_URL` / `PUBTATOR_BASE_URL` / `EPMC_BASE_URL` | 官方端点 | 自建反代端点 |
| `SKILL_DOC` | `true` | Agent 路由技能自动注册 |
| `RELATION_ENDPOINT_REQUIRE_KEYWORD` | `true` | 图谱关系边语义门 |
| `HEURISTIC_RELATIONS` | `true` | 启发式关系层（false = 纯 curated 图）|

> 限速、重试、OA 签名校验等均为内置行为，无需配置。

---

## 无代理网络（大陆直连）

免费直连是本插件的定位。网络类失败自动指数退避重试，NCBI 不可达时检索自动切换 Europe PMC（其 MED 源即 PubMed 本体），报错区分"本地代理已挂"与"目标不可达"。极致稳定需求可配 `*_BASE_URL` 自建反代。

---

## 给 Agent 的说明

随包附带 `skills/dsh-pubmed/SKILL.md`——**激活时自动注册**到 `~/.dsh/skills/dsh-pubmed/`（DSH 扫描的技能 root）。新会话的 agent 会自动读到：26 个工具的完整路由规则、模块串联流程、OA 工作流、易错点清单。

**你不需要记住任何工具名**——用自然语言描述需求即可。如果你的 agent 需要了解调用细节，让它读 SKILL 或工具描述即可。

---

## 附录：26 工具速查

> 供查阅的完整清单。日常使用无需记忆——agent 会自动路由。

**检索**：`pubmed_search_papers`（跨源统一检索 ⭐）· `pubmed_search_articles`（PubMed 完整语法，含摘要）· `pubmed_europepmc_search`（预印本/专利）· `pubmed_pubtator_search`（语义/关系检索）· `pubmed_search_s2`（全领域）· `pubmed_find_related`（相似/被引/参考文献）

**全文与元数据**：`pubmed_fetch_articles`（结构化文章 + 自动入图）· `pubmed_fetch_fulltext`（两级链：PMC → Europe PMC，分页）· `pubmed_fetch_pdf_oa`（OA PDF 发现 + 下载）· `pubmed_europepmc_fetch`（EPM 完整记录）

**引用与 ID**：`pubmed_format_citations`（APA/MLA/BibTeX/RIS/Vancouver）· `pubmed_convert_ids`（DOI/PMID/PMCID 互转）· `pubmed_lookup_citation`（残缺引文→PMID）· `pubmed_lookup_mesh`（MeSH 词表）· `pubmed_spell_check`（拼写纠正）

**PubTator3 概念层**：`pubmed_pubtator_entity_id`（文本→概念 ID）· `pubmed_pubtator_relations`（curated 关系 + 证据）· `pubmed_pubtator_annotate`（实体标注）

**知识图谱**：`pubmed_graph_add`（增量入图：articles 或 pmids 批量直入）· `pubmed_graph_get`（JSON/mermaid）· `pubmed_graph_commit`（持久化）· `pubmed_graph_reset`（清空）

**Semantic Scholar**：`pubmed_get_s2_detail`（被引数）· `pubmed_get_s2_citations`（引文列表）· `pubmed_get_s2_recommendations`（推荐）· `pubmed_match_paper_by_title`（标题匹配）

---

## 安装与卸载（完整）

### 安装

**1. 一条命令（官方 CLI，推荐）**

```bash
dsh plugin --profile web add dsh-pubmed@latest
# 或从 GitHub：dsh plugin --profile web add github:aiyacharley/dsh-pubmed
# 或本机源码：dsh plugin --profile web add /path/to/dsh-pubmed
```

**2. 复制粘贴给 Agent 自动安装**（需 `cordis` 预设的会话）：

- 持久化（重启后全会话可用）：
````text
【请帮我持久化安装 dsh-pubmed（重启后所有会话可用）】
1) 找到 DSH profile 名称（如 web；不确定就先问）。
2) 运行 dsh plugin --profile <名称> add dsh-pubmed@latest。
3) 提示用户重启 DSH。
````

- 会话级（当前会话立即生效，需本机有源码）：
````text
【请帮我安装 dsh-pubmed 插件（26 个工具）】
1) 先定位 dsh-pubmed 包目录（含 lib/pubmed-core.js）；若本机还没有，先 git clone https://github.com/aiyacharley/dsh-pubmed.git。
2) 读取 lib/dynamic-wrapper.js 作为 cordis_define 的 code.host，替换 <DSH_PUBMED_CORE_PATH> 与 <DSH_PUBMED_DIR> 占位符。
3) cordis_run 激活（mode=run）。
4) 验证：pubmed_spell_check({query:"microbiom"}) 应返回 corrected="microbiome"。
````

**3. 手动（可选）**

- patch：profile 的 `cordis.patch.yml` 追加 `- insert: [{ id: pubmed, name: 'dsh-pubmed' }]` → 重启；
- 会话级：手动 `cordis_define` / `cordis_run`（模板见 `lib/dynamic-wrapper.js`）。

### 更新

```bash
dsh plugin --profile web update dsh-pubmed@latest     # 或 @0.4.2 指定版本
```

更新后**重启 DSH** 生效。

### 卸载

- **会话级**：`cordis_undefine` 该插件即可（或重启 DSH，会话级插件本就不持久）；
- **持久化**：`dsh plugin --profile <名称> remove dsh-pubmed` 后重启；
  若还配了原版 pubmed-mcp-server 的 MCP 桥接（`mcp-pubmed` 行），一并删除并重启。
- 复制粘贴给 Agent 自动卸载：

````text
【请帮我卸载 dsh-pubmed（重启后所有会话不再有 pubmed_* 工具）】
1) 找到 DSH profile 名称（如 web；不确定就先问）。
2) 运行 dsh plugin --profile <名称> remove dsh-pubmed。
   若该命令不可用，则手动：从 package.json 删除 "dsh-pubmed" 依赖（及 bundles 里的条目），
   从 cordis.patch.yml 删除 id 为 pubmed 的 insert 块，再 npm install。
3) 提示用户重启 DSH。
````

> **卸载后残留**：技能文档 `~/.dsh/skills/dsh-pubmed/` 会保留（孤儿文件，可手动删除）；
> 用户图谱文件 `~/.dsh/dsh-pubmed-graph.json` 也会保留（你的知识资产，按需手动删）。

---

## 版本历史

- **v0.4.3** — **图谱与链路增强**：`graph_add` 支持 `pmids` 批量直入（≤200，自动取文+富集）；`fetch_fulltext` 升级两级链（PMC → Europe PMC fullTextXML，EPMC-only OA 也有正文）；**ID 解析缓存**（含负结果，串联链路零重复解析）；批量工具超时预算（120–180s）；`fetch_pdf_oa` 候选位置带多源来源标注 + Best PDF 推荐 + F3 换算回显。
- **v0.4.2** — **OA PDF 发现与下载 + 图谱去噪**：新增第 26 个工具 `pubmed_fetch_pdf_oa`——给**单个或批量**（≤10）DOI/PMID/PMCID 聚合 **Unpaywall + Europe PMC + OpenAlex** 三源，返回去重排序的 OA 链接列表；`download:true` 把 PDF 存到本地（文件名用 PMID/DOI，仅落盘不解析）；**PDF 签名校验**（出版社 HTML 拦截页自动跳过）；**统一搜索结果新增 OA 标记**（零额外请求）；**图谱去噪**（语义门 + mermaid 裁剪 + 纯 curated 开关）；新增 `UNPAYWALL_EMAIL` 配置。
- **v0.4.1** — **统一搜索增强**：`pubmed_search_papers` 默认三源（PubMed + Europe PMC + **OpenAlex**）；`sources` 加 `'s2'`/`'all'`；`sort` 与 `year` 跨源过滤（下推各源查询）；agent 路由描述补全。
- **v0.4.0** — **生态补全 + 反代可配**：跨源统一检索；Semantic Scholar 五工具；`fetch_fulltext` 分页切片；BASE_URL 可配；发布后自动同步 npmmirror。
- **v0.3.9** — 移除已废弃的 `pubmed_extract_keywords`。
- **v0.3.8** — Europe PMC 网络重试；图谱原子写 + 串行化；@ 前缀归一化；SKILL 扩充；npm scripts + CI 测试门。
- **v0.3.7** — 大规模建图不再超时（批量预取 + 预算 + 超时分级）。
- **v0.3.6** — 技能文档自注册。
- **v0.3.5** — 无代理韧性（重试 + EBI 降级链 + 可行动报错）。
- **v0.3.4** — 显示层补齐；500 篇建图压测 70ms。
- **v0.3.3** — 关系证据回查；annotate 分批 + 缓存；`graph_add({dryRun})` 预览。
- **v0.3.2** — annotate 支持 PMCID；SKILL 路由技能随包。
- **v0.3.1** — 真机验收；`pubtator_search` query 可选。
- **v0.3.0** — `pubmed_pubtator_search` 语义/关系检索。
- **v0.2.2** — PubTator 独立限流队列；探测先过滤后截断。
- **v0.2.1** — PubTator3 概念层 + 建图 concept 节点。
- **v0.2.0** — 个人文献知识图谱引擎。
- **v0.1.x** — 初版：自 [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server) 移植的 11 个 PubMed 工具。

> 逐版提交细节见 [git tags](https://github.com/aiyacharley/dsh-pubmed/tags)；设计文档见
> [`docs/00_roadmap.md`](docs/00_roadmap.md)（主计划书）、[`docs/01_pubtator3-plan.md`](docs/01_pubtator3-plan.md)、
> [`docs/02_optimization-review.md`](docs/02_optimization-review.md)。

---

## 要求

- DSH（任意支持 Cordis bundle 的部署）
- Node.js ≥ 20（bundle 使用全局 `fetch`）
- 出网可访问 `eutils.ncbi.nlm.nih.gov`、`www.ncbi.nlm.nih.gov`（PubTator3）、`www.ebi.ac.uk` 与 `api.semanticscholar.org`

---

## License 与致谢

Apache-2.0。

- **来源**：最初移植自 [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server)
  （Apache-2.0，作者 Casey Hand）——检索、文章元数据、全文、引用、MeSH、ID 转换等核心 PubMed 能力源于该项目。
- **本插件的扩展**（原项目没有的能力）：个人文献知识图谱引擎、PubTator3 概念层、启发式 NLP、
  NPG 配色 mermaid 可视化、跨源统一检索（含 OpenAlex）、Semantic Scholar 直连、OA 全文 PDF 发现与下载、
  无代理韧性、配置驱动的双策略设计等，均为本插件原创实现。

> 本插件不再是单纯的"移植版"：PubMed 检索层致敬原项目，知识图谱、概念层与统一检索为独立扩展。
