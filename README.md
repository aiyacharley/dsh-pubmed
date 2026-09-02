# dsh-pubmed

**简体中文** | [English](README_EN.md)

[![npm version](https://img.shields.io/npm/v/dsh-pubmed)](https://www.npmjs.com/package/dsh-pubmed)
[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/aiyacharley/dsh-pubmed)

> **给科研文献检索装上"实体级 + 证据链"引擎**：PubMed / Europe PMC / PubTator3 / Semantic Scholar 四源一体的
> DeepSeek Harness（DSH）插件，25 个原生模型工具，无 MCP 客户端、无付费代理、纯 JS 免构建。
>
> 一句话：**把"关键词匹配"升级为"实体归一 + 关系语义 + 证据可审计"，把 80% 的机械筛库时间变成 20% 的高质量阅读时间。**

---

## 目录

- [🚀 安装（2 分钟上手）](#-安装2-分钟上手)
- [为什么需要它](#为什么需要它)
- [三大亮点](#三大亮点)
- [25 个工具 · 按任务分组](#25-个工具--按任务分组)
- [真实场景剧本](#真实场景剧本)
- [配置](#配置)
- [无代理网络（大陆直连）](#无代理网络大陆直连)
- [Agent 路由技能（自动注册）](#agent-路由技能自动注册)
- [安装与卸载（完整）](#安装与卸载完整)
- [版本历史](#版本历史)
- [要求](#要求)
- [License 与致谢](#license-与致谢)

---

## 🚀 安装（2 分钟上手）

```bash
# 一条命令安装（官方 CLI，推荐）
dsh plugin --profile web add dsh-pubmed@latest
# 或从 GitHub：dsh plugin --profile web add github:aiyacharley/dsh-pubmed
# 或本机源码：dsh plugin --profile web add /path/to/dsh-pubmed
```

装完**重启 DSH**，`pubmed_*` 出现在所有会话。自检一条：

```
pubmed_spell_check({ query: 'microbiom' })    # → corrected: "microbiome"
```

> 零配置即可用；更多安装方式（粘贴给 Agent 自动装 / 手动 patch）见文末
> [安装与卸载（完整）](#安装与卸载完整)，卸载见同节。

---

## 为什么需要它

做文献调研时，你大概率遇到过这几个痛点：

| 痛点 | 传统做法 | 结果 |
|---|---|---|
| **同义词漏检** | 搜 `DOX` 搜不到"阿霉素"、搜 `HER2` 漏掉 `ERBB2` | 漏掉一半相关文献 |
| **噪音混入** | 关键词共现把"只是顺便提到"的文章也搜进来 | 读十篇只有一篇相关 |
| **证据链断裂** | 看到"某药可治某病"却不知道哪些文献支撑 | 不敢放心引用 |
| **被引数据缺失** | PubMed 本身不提供被引数 | 判断影响力要靠外部网站 |
| **多平台割裂** | PubMed / EBI / Google Scholar 来回切、手工去重 | 时间都耗在搬运上 |

dsh-pubmed 用 **实体归一化、关系语义、证据回查、跨源去重、被引直连** 五件事逐一回应这些痛点。
它不替你读文献，而是让你**读到的每一篇都更可能是对的**。

---

## 三大亮点

### 亮点一：实体级检索 —— 免疫同义词噪音

PubTator3 先把自由文本归一到**权威概念 ID**（`metformin` → `@CHEMICAL_Metformin` → `MESH:D008687`），
再用"关系式"直达**支持某条关系**的文章，而不是靠关键词共现：

```
"二甲双胍能治什么病？给我证据文献"
→ pubmed_pubtator_entity_id({ query: 'metformin', concept: 'chemical' })   # 文本 → 规范 @ID
→ pubmed_pubtator_relations({ e1: '@CHEMICAL_Metformin', e2: 'disease', evidence: true })
      @CHEMICAL_Metformin --[treat(8423)]--> @DISEASE_Diabetes_Mellitus_Type_2
        ev: PMID 36619226, PMID 34904090, ...     ← 证据文献直出，可审计
```

同义词、缩写、大小写、语种差异全部由实体 ID 吸收——你问"阿霉素"，它找的是 `MESH:D004317` 下所有文献。

### 亮点二：个人文献知识图谱 —— 证据可累积、可审计、可可视化

每次取文章（`pubmed_fetch_articles`）在 `AUTO_GRAPH` 默认开启下**自动并入**当前会话图谱，无需手动建图：

- **关键词节点**：MeSH 加权 + NLP 名词短语；
- **concept 节点**：PubTator3 实体，带权威概念 ID（如 `IgA[973]`、`human[9606]`），**按 ID 跨文章去重**；
- **curated 关系边**：treat / interact / ...，weight = publications 证据数，默认带 `evidencePmids` 支持文献；
- **启发式关系边**："X 调控 Y" 这类词干关系（无依赖的兜底层，PubTator 不可用时自动降级）。

```
fetch_articles（自动入图）→ 多轮增量累积 → graph_get({format:'mermaid'}) 可视化 → graph_commit 持久化
```

满意后 `pubmed_graph_commit` 一键持久化到 `~/.dsh/dsh-pubmed-graph.json`（跨会话保留）。一张 NPG 配色卡片
就能看清：哪些概念反复出现、哪些关系有文献支撑、你的综述覆盖了哪些方向。

### 亮点三：跨源统一检索 + 被引数据 —— 一次拿全

- **`pubmed_search_papers`（跨源统一检索）**：一条查询同时打 PubMed + Europe PMC，按 DOI / PMID / 规范化标题
  **去重合并**，多平台命中的文章排最前，并顺带合并 Europe PMC 的被引数，`perSource` 报告各源成败；
  **可选**把 Semantic Scholar 也加进来（`sources: ['pubmed','europepmc','s2']`），一并去重合并。
- **Semantic Scholar 五工具**：补上 PubMed 生态缺失的三件事——**被引数**（`get_s2_detail`）、
  **论文推荐**（`get_s2_recommendations`）、**标题精确匹配**（`match_paper_by_title`），
  外加**全领域检索**（`search_s2`，不限于生物医学）。官方免费 API，无 key 也能用。

---

## 25 个工具 · 按任务分组

> 分组的逻辑：**先想你要做什么，再选这一组里的工具**。工具描述里也内置了互指路由，agent 不会调错。

### 🔍 检索

| 工具 | 作用 | 什么时候用 |
|---|---|---|
| `pubmed_search_articles` | PubMed 关键词检索（完整布尔 / 字段 / 日期语法） | 要字段限定、日期范围、出版类型过滤 |
| `pubmed_europepmc_search` | Europe PMC 检索（MED/PMC/PPR/PAT/AGR 五源，游标分页） | PubMed 覆盖不足（预印本 / 专利 / 非期刊）|
| `pubmed_search_papers` | **跨源统一检索**：PubMed + Europe PMC 去重合并排序（可 `sources` 加 `'s2'`/`'all'` 并入 Semantic Scholar；`year` 跨源过滤，`sort` 按被引/年份排序） | 要一份多平台综合列表，省去手工去重 |
| `pubmed_pubtator_search` | PubTator3 语义 / 关系检索（@实体 / 布尔 / `relations:` 式） | 提到具体生物实体或药-病关系 |
| `pubmed_search_s2` | Semantic Scholar 全领域检索（含被引数、归一化 ID） | 跨领域检索、要影响力信息 |
| `pubmed_find_related` | 从一篇已知文章顺藤摸瓜：相似 / 被引 / 参考文献 | 引文网络扩张 |

### 📖 全文与元数据

| 工具 | 作用 | 什么时候用 |
|---|---|---|
| `pubmed_fetch_articles` | 按 PMID 取结构化文章（作者 / 摘要 / MeSH / 基金 / DOI / PMCID）；`AUTO_GRAPH` 默认开时**自动入图** | 要精读元数据、或给图谱喂数据 |
| `pubmed_fetch_fulltext` | PMC 全文（JATS → 分节正文；可 `offset`/`maxCharacters` **分页续读**长文） | 40 页论文分页读，不冲爆上下文 |
| `pubmed_europepmc_fetch` | 按 source+id 取 EPM 完整记录（含未截断摘要） | 预印本 / 专利等非 PubMed 记录 |

### 📝 引用与 ID

| 工具 | 作用 | 什么时候用 |
|---|---|---|
| `pubmed_format_citations` | APA 7 / MLA 9 / BibTeX / RIS / Vancouver 引用 | 写稿引用、投稿格式 |
| `pubmed_convert_ids` | DOI / PMID / PMCID 互转 | 手里是 DOI 想拿 PMID/PMCID |
| `pubmed_lookup_citation` | 残缺引文（期刊 / 年份 / 卷 / 页 / 作者）→ PMID（ECitMatch） | 参考文献缺 ID，或想溯源某条引用 |
| `pubmed_lookup_mesh` | MeSH 词表（树号 / 范围注释 / 入口词） | 确认规范主题词、扩同义词 |
| `pubmed_spell_check` | 检索词拼写纠正（ESpell） | 不确定拼写时先纠错再搜 |

### 🧬 PubTator3 概念层（语义 / 关系）

| 工具 | 作用 | 什么时候用 |
|---|---|---|
| `pubmed_pubtator_entity_id` | 自由文本生物概念 → 规范 @概念 ID（autocomplete） | 检索前先把"阿霉素"归一成 `@CHEMICAL_Doxorubicin` |
| `pubmed_pubtator_relations` | 概念间 curated 关系（treat/cause/inhibit/...，带 publications 证据数；`evidence:true` 附支持文献 PMIDs） | "X 和 Y 有什么关系"、关系骨架扫描 |
| `pubmed_pubtator_annotate` | 文本实体标注（Gene/Chemical/Disease/Mutation/CellLine/Species，带概念 ID；收 PMID 或 PMCID，>100 自动分批） | 把一篇文章的实体"解剖"出来 |

### 🕸️ 知识图谱

| 工具 | 作用 | 什么时候用 |
|---|---|---|
| `pubmed_graph_add` | 把一轮文章**增量并入**当前会话图谱；`dryRun:true` 只预览不落盘 | 手动喂数据、或先预览会新增什么 |
| `pubmed_graph_get` | 取会话 / 用户图谱（JSON，或 NPG 配色 mermaid 卡片） | 可视化、盘点已积累的知识 |
| `pubmed_graph_commit` | **显式**把会话图谱并入持久化的用户图谱（默认不自动写） | 一轮调研收尾，存为长期资产 |
| `pubmed_graph_reset` | 清空会话（或用户）图谱 | 换主题重来 |

### 🌐 Semantic Scholar（被引 / 推荐 / 匹配）

| 工具 | 作用 | 什么时候用 |
|---|---|---|
| `pubmed_get_s2_detail` | 单篇详情（被引数 / 参考文献数 / OA / 全部 ID） | 快速给已知论文补被引数 |
| `pubmed_get_s2_citations` | **引用该篇**的文章列表 | 追踪一篇论文的下游影响 |
| `pubmed_get_s2_recommendations` | "读了这篇还读哪些"的推荐 | 顺着一篇好论文找同类 |
| `pubmed_match_paper_by_title` | 标题精确匹配 → ID / 被引数 / 元数据 | 手里有标题想定位到论文 |

---

## 真实场景剧本

### 剧本 A：写综述 —— 把"某药治某病"的证据链一次性拉全

```
1. pubmed_pubtator_entity_id({ query: 'metformin', concept: 'chemical' })   # 文本 → @CHEMICAL_Metformin
2. pubmed_pubtator_relations({ e1: '@CHEMICAL_Metformin', e2: 'disease', evidence: true })
     # 关系骨架：treat(8423)→T2DM / treat(2275)→Neoplasms / ...，每条带证据文献 PMIDs
3. pubmed_pubtator_search({ relationType: 'treat', e1: '@CHEMICAL_Metformin', e2: 'DISEASE' })
     # 相关文章按相关度排序 + 年份/期刊 facets
4. pubmed_fetch_articles({ pmids: [...] })   # 精读候选，AUTO_GRAPH 自动入图
5. pubmed_graph_get({ scope: 'session', format: 'mermaid' })   # 证据链可视化
```

### 剧本 B：药物重定位 / 机制假设扫描

```
# 某个基因与所有疾病的关联全谱
pubmed_pubtator_relations({ e1: '@GENE_TP53', e2: 'disease' })
# 命中个位数关联 = 可能被低估的方向 → 用 search 钻取证据文章
pubmed_pubtator_search({ query: '@GENE_TP53 AND @DISEASE_X' })
```

### 剧本 C：选题新颖性检验

```
# 两个概念的共现文献量：命中个位数 ≈ 可能是空白方向
pubmed_pubtator_search({ query: '@DISEASE_COVID_19 AND @GENE_PON1' })
# 双平台交叉验证
pubmed_search_papers({ query: 'COVID-19 AND PON1' })
```

### 剧本 D：系统化文献管理 —— 多轮累积 + 可视化 + 持久化

```
pubmed_fetch_articles({ pmids: [...] })        # 每轮自动入图
# ... 多轮检索不断并入（按会话隔离）...
pubmed_graph_get({ scope: 'session', format: 'mermaid', maxKeywords: 15 })   # 阶段性盘点
pubmed_graph_commit({ confirm: true })         # 满意 → 持久化到个人图谱（跨会话保留）
pubmed_graph_get({ scope: 'user' })            # 下次继续时取回
```

### 剧本 E：精确引用与 ID 管理

```
# 残缺引文定位：手头只有期刊/年份/卷/页/作者
pubmed_lookup_citation({ citations: [{ journal: 'Nucleic Acids Res', year: '2013', volume: '41', firstPage: 'D36', authorName: 'Benson' }] })
# 引用格式：APA / BibTeX 一步到位
pubmed_format_citations({ pmids: ['23193287'], styles: ['apa', 'bibtex'] })
# 被引数与 OA PDF：判断一篇论文的分量
pubmed_get_s2_detail({ paperId: 'PMID:23193287' })
```

---

## 配置

bundle 运行时**零配置即可用**。可选配置建议写进 profile 的 patch 行 `config`（比环境变量更稳，
因为环境变量可能因 DSH 启动方式不同而读不到）：

```yaml
# 你的 profile 文件，如 C:\Users\<你>\.dsh\profiles\<profile>\cordis.patch.yml
# 注意：补丁条目是【裸对象 { id, config }】，不要用 `- override:` 包装。
- id: pubmed
  config:
    NCBI_API_KEY: '<可选：NCBI API key>'
    # AUTO_GRAPH: false   # 默认 true：fetch_articles 自动并入会话图谱
    # PUBTATOR: false     # 默认 true：建图概念层（PubTator 概念 + curated 关系）
    # S2_ENABLED: false   # 默认 true：Semantic Scholar 五工具
    # S2_API_KEY: '<可选：免费 S2 key>'
    # EUTILS_BASE_URL: 'https://你的反代/entrez/eutils'   # 可选：自建反代
```

| 配置项 | 默认 | 作用 |
|---|---|---|
| `NCBI_API_KEY` | 无 | NCBI 限流提速：10 req/s（无 key ≈3 req/s）|
| `NCBI_ADMIN_EMAIL` | 内置 noreply | NCBI 合规联系邮箱 |
| `AUTO_GRAPH` | `true` | `fetch_articles` 自动并入会话图谱 |
| `PUBTATOR` | `true` | 建图概念层开关（关掉只走启发式关键词/关系）|
| `PUBTATOR_EDGE_EVIDENCE` | `true` | curated 关系边附证据文献 PMIDs |
| `PUBTATOR_RELATION_PROBE` | `3`（上限 6）| 每篇文章的关系探测概念数 |
| `PUBTATOR_RELATION_PROBE_ARTICLES` | `8`（上限 50）| 每次建图合并的关系探测文章数 |
| `EUROPEPMC_ENABLED` | `true` | Europe PMC 双工具开关 |
| `S2_ENABLED` | `true` | Semantic Scholar 五工具开关 |
| `S2_API_KEY` | 无 | S2 免费 key：1 req/s（无 key 走共享 100 req/5min）|
| `EUTILS_BASE_URL` / `PUBTATOR_BASE_URL` / `EPMC_BASE_URL` | 官方端点 | 自建反代端点，扛区域网络波动 |
| `SKILL_DOC` | `true` | 激活时自动注册 agent 路由技能文档 |

**内置限速**：NCBI E-utilities 走全局队列（有 key ~120ms / 无 key ~350ms），PubTator3 走独立 ~350ms 队列
（官方 3 req/s，与 API key 无关），Semantic Scholar 走独立队列（无 key ~3s / 有 key ~1.1s）。并行调用会自动串行化，不会触发 429。

---

## 无代理网络（大陆直连）

免费直连是本插件的定位。从 v0.3.5 起，无代理时依然可用：

- **自动重试**：网络类失败按指数退避自动重试（覆盖 NCBI 的"黑洞窗口"），HTTP 4xx/5xx 视为真实答案不重试；
- **Europe PMC 降级链**：NCBI 持续不可达时，`search_articles` / `convert_ids` / `find_related(cited_by/references)`
  自动切换 Europe PMC（其 MED 源即 PubMed 本体），结果带 `[via europepmc fallback]` 标记；
- **可行动报错**：自动区分"本地代理已挂"与"目标不可达"，不再抛裸 `fetch failed`；
- **自建反代**：极致稳定需求可配 `*_BASE_URL` 指向自己的反向代理（v0.4.0 已实现）。

---

## Agent 路由技能（自动注册）

随包附带 `skills/dsh-pubmed/SKILL.md`：一份给 agent 看的 **25 工具路由指南**（按话术选入口、建图链路组合流、
四类搜索边界、限速常识）。**插件激活时自动写入 `~/.dsh/skills/dsh-pubmed/`**（DSH 扫描的技能 root），
纯净安装零手工；内容随版本升级自动改写（幂等）。`SKILL_DOC:false` 可关闭。

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
【请帮我安装 dsh-pubmed 插件（25 个工具）】
1) 先定位 dsh-pubmed 包目录（含 lib/pubmed-core.js）；若本机还没有，先 git clone https://github.com/aiyacharley/dsh-pubmed.git。
2) 读取 lib/dynamic-wrapper.js 作为 cordis_define 的 code.host，替换 <DSH_PUBMED_CORE_PATH> 与 <DSH_PUBMED_DIR> 占位符。
3) cordis_run 激活（mode=run）。
4) 验证：pubmed_spell_check({query:"microbiom"}) 应返回 corrected="microbiome"。
````

**3. 手动（可选）**

- patch：profile 的 `cordis.patch.yml` 追加 `- insert: [{ id: pubmed, name: 'dsh-pubmed' }]` → 重启；
- 会话级：手动 `cordis_define` / `cordis_run`（模板见 `lib/dynamic-wrapper.js`）。

### 更新

`dsh plugin` 是 pnpm 的薄转发器——`update` 直接透传 pnpm 的 update，并在成功后按新版本的
`dsh.bundle` 声明自动对齐 bundle 层（若新版新增或移除了 bundle 声明也会自动生效，无需手动改 patch）。

```bash
# 更新到最新版
dsh plugin --profile web update dsh-pubmed@latest
# 更新到指定版本（如 0.4.0）
dsh plugin --profile web update dsh-pubmed@0.4.0
```

> 更新后**重启 DSH** 生效。`add dsh-pubmed@latest` 同样可作升级用（已安装时 pnpm add @latest 也会升到最新）。

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

- **v0.4.0** — **生态补全 + 反代可配**：`pubmed_search_papers` 跨源统一检索（去重合并 + perSource 报告）；Semantic Scholar 五工具（被引数 / 推荐 / 标题匹配 / 全领域）；`fetch_fulltext` 分页切片；`EUTILS_BASE_URL` / `PUBTATOR_BASE_URL` / `EPMC_BASE_URL` 可配；发布后自动同步 npmmirror（国内 1 分钟内可装）。
- **v0.3.9** — 移除已废弃的 `pubmed_extract_keywords`（19 工具）；README/SKILL/cordis 清理。
- **v0.3.8** — P4 批次二：Europe PMC 网络重试层；用户图谱原子写（防崩溃损坏）；图写入按会话串行化；@ 前缀自动归一化；SKILL 扩充；npm scripts + CI 测试门。
- **v0.3.7** — P0 修复：大规模建图不再超时（mergeGraph 批量预取 200 篇 200+ 次调用 → 2 次；探测/证据预算；富集 150s 死线；httpGet 超时真正生效）。
- **v0.3.6** — 技能文档自注册（激活时自动写入 `~/.dsh/skills/`，幂等）。
- **v0.3.5** — 无代理韧性：网络分类重试 + Europe PMC 降级链 + 可行动报错。
- **v0.3.4** — 显示层补齐（关系证据行 / 图谱证据边汇总 / annotate 分批信息）；500 篇建图压测 70ms。
- **v0.3.3** — 关系证据回查（`evidence:true` → 支持文献 PMIDs 入边）；annotate 自动分批 + 会话缓存；类型优先探测；修复自环/占位 ID/mermaid classDef；`graph_add({dryRun})` 预览。
- **v0.3.2** — annotate 支持 PMCID；7 个工具描述加路由语句；随包 SKILL 路由技能。
- **v0.3.1** — 真机验收；`pubtator_search` 的 `query` 改可选（便捷参数真正可用）。
- **v0.3.0** — 第 20 个工具 `pubmed_pubtator_search`：语义 / 布尔 / 关系式检索 + facets。
- **v0.2.2** — PubTator 独立 350ms 限流队列；关系探测先过滤后截断。
- **v0.2.1** — PubTator3 概念层（annotate / entity_id / relations）+ 建图 concept 节点。
- **v0.2.0** — 个人文献知识图谱引擎：会话/用户双图谱、增量合并、mermaid NPG 配色、AUTO_GRAPH、NLP 关键词与关系边。
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
- **本插件的扩展**（原项目没有的能力）：个人文献知识图谱引擎（会话/用户双图谱、增量合并）、
  PubTator3 概念层（带权威概念 ID 的实体节点 + curated 关系边）、启发式 NLP（名词短语关键词 + 词干关系抽取）、
  NPG 配色 mermaid 可视化、跨源统一检索、Semantic Scholar 直连、代理网络兜底、配置驱动的双策略（主路径+兜底）等，
  均为本插件原创设计实现。

> 因此本插件不再是单纯的"移植版"：PubMed 检索层致敬原项目，知识图谱与概念层为独立扩展。
