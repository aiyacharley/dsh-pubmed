# dsh-pubmed · PubTator3 功能补全计划

| 项 | 内容 |
|---|---|
| 状态 | 草案 v1（待评审） |
| 日期 | 2025-06 |
| 影响版本 | v0.3.0 / v0.3.1 / v0.4.0 |
| 涉及文件 | `lib/pubmed-core.js`、`lib/index.js`、`lib/dynamic-wrapper.js`、`test/*.mjs`、`README*.md`、`CHANGELOG.md` |
| 参考 | [PubTator3 API](https://www.ncbi.nlm.nih.gov/research/pubtator3/api) · [Tutorial](https://www.ncbi.nlm.nih.gov/research/pubtator3/tutorial) |

---

## 1. 背景与目标

dsh-pubmed v0.2.1 已集成 PubTator3 的三个点状 API（标注导出 / 实体 ID 解析 / curated 关系查询），
并用它们构建知识图谱的"概念层"。对照官方 API 全貌，还有四块能力缺失：

1. **语义 / 关系搜索**（官方旗舰功能）——按实体、布尔组合、甚至"实体对之间的关系"检索文章；
2. **关系证据回查**——现在图谱 relation 边只有 publications 计数，无法回答"哪些文章支持这条关系"；
3. **PMCID 维度的标注导出**——全文链路（`pubmed_fetch_fulltext` 返回 PMCID）与标注链路（只收 PMID）断裂；
4. **原始文本标注**——用同一套 AI 模型（AIONER/tmVar3/GNorm2）标注用户自己的文本。

**总目标**：把现有"实体 → 关系"链路补成
**实体 → 关系 → 证据文章 → 建图** 的完整闭环，同时保持插件轻量、零 key、可降级的定位。

## 2. 现状盘点

### 2.1 已集成（v0.2.1）

| 工具/机制 | 官方端点 | 备注 |
|---|---|---|
| `pubmed_pubtator_annotate` | `/publications/export/biocjson?pmids=…`（支持 `full`） | 限 100 PMID，超量静默截断 |
| `pubmed_pubtator_entity_id` | `/entity/autocomplete/`（query/concept/limit） | 已剥离 match 高亮 HTML |
| `pubmed_pubtator_relations` | `/relations?e1=&type=&e2=` | 客户端截断 limit（默认 25） |
| 建图富集 `mergeGraph` | annotate + relations 组合 | concept 节点按 `type:id` 跨文章去重；curated 关系边 weight=证据数；失败静默降级为启发式 NLP |

### 2.2 已发现的两个存量问题（✅ 已修复，回归测试 `test/pubtator-default-test.mjs`）

- **[BUG-1] 限流共用错误**：PubTator 调用走 `ncbiScheduled` 队列。配置 `NCBI_API_KEY` 后
  `NCBI_GAP_MS=120`（≈8 req/s），**超出 PubTator3 官方 3 req/s 上限**（该限速与 NCBI API key 无关）。
  → 修复：新增独立 `pubtatorScheduled` 队列（固定 350ms 间距），5 个 PubTator 调用点全部迁移。
- **[BUG-2] 关系探测先截断后过滤**：`defaultExtractPubtatorRelations` 对 relations 结果
  先 `slice(0, 20)` 再过滤"文内边"，hub 概念的文内边可能被截掉。
  → 修复：改为先过滤文内边、后按 20 条截断。

### 2.3 真机验证（v0.2.2）新发现的存量小瑕疵（→ P3.5）

2025-06 真机测试（PMID 29355051 + 39747692 建图全链路）记录；均为存量问题，与前置修复无关：

- **[瑕疵-1] 自环关系边**：图谱出现 `IgA[973] --interact--> IgA[973]`——PubTator 对免疫球蛋白
  二聚体返回 source==target 的自身相互作用，`defaultExtractPubtatorRelations` 未过滤。
  修复：映射到 nodeId 后跳过 `tNode === c.nodeId` 的关系。
- **[瑕疵-2] 空/占位 ID 概念节点**：PubTator 对未归一化提及会给出空或占位标识符，入图后出现
  `Chinese herbal[-]` 这类节点。修复：概念入图前丢弃空 ID（与 `mergeGraph` 现有的
  `if (!cid) continue` 防御合并，同时覆盖 `-` 这类占位值）。
- **[瑕疵-3] mermaid classDef 错位**：`minCount` 修剪后同一节点可能同时进入 kw 与 concept
  两个 class 列表（本次 `tumor`/`H22` 双重命中），渲染可能串色。修复：mermaid 生成器的
  class 分配按修剪后的最终节点列表计算、互斥归类。

## 3. 功能规划总表

| 优先级 | 功能 | 新增/改动 | 价值 | 工作量 | 计划版本 |
|---|---|---|---|---|---|
| ✅ 前置 | P3.1 PubTator 限流队列分离 + BUG-2 修复 | 改 core | 正确性修复，P0 上量前必须先做 | 0.25d | 已完成 |
| ✅ **P0** | **`pubmed_pubtator_search` 语义/关系搜索** | 新工具 | 补齐旗舰能力，打通建图闭环 | 0.5–1d | ✅ 已完成（v0.3.0） |
| P1b | annotate 支持 PMCID（`pmc_export`） | 扩展现有工具 | 全文链路补口子 | 0.25d | ✅ 已完成（v0.3.2） |
| ✅ P3.6 | 工具描述路由语句（7 个工具）+ 随包 `skills/dsh-pubmed/SKILL.md` | 改 core + 新增 skills/ | 新会话 agent 正确调度三套检索与建图工具 | 0.25d | ✅ 已完成（v0.3.2） |
| ✅ P1a | ~~新增 relation_evidence 工具~~ → **改设计：`pubtator_relations` 加 `evidence:true`** + 图谱边 evidencePmids | 改 core | 边从"计数"变"可审计"；工具数不膨胀 | 0.5d | ✅ 已完成（v0.3.3） |
| ✅ P3.2 | annotate >100 PMID 自动分批（100/批 + 上限 500） | 改 core | 大批量不丢数据 | 0.25d | ✅ 已完成（v0.3.3） |
| ✅ P3.3 | 会话级 annotate 缓存统一（工具与建图共用，键含 full/abs） | 改 core | 同 PMID 不重复拉取 | 0.25d | ✅ 已完成（v0.3.3） |
| ✅ P3.4 | 建图关系探测策略化（Disease>Chemical>Gene>Variant 类型优先 + PUBTATOR_RELATION_PROBE 可配置）；超时常量化 | 改 core | 高价值边更全 | 0.25d | ✅ 已完成（v0.3.3） |
| ✅ P3.5 | 真机验证发现的 3 个存量小瑕疵（自环边 / 空 ID 概念 / mermaid classDef 错位，见 §2.3） | 改 core | 数据质量与渲染正确性 | 0.25d | ✅ 已完成（v0.3.3） |
| ✅ P3.7 | 精简合并：`extract_keywords` 废弃 → `graph_add({dryRun:true})` 预览；nlp.js 懒加载降级（compromise 缺失不炸 bundle 加载）；mesh/entity_id 描述互指 | 改 core + nlp | 工具语义更干净、加载更健壮 | 0.25d | ✅ 已完成（v0.3.3） |
| **P2** | **`pubmed_pubtator_annotate_text` 原始文本标注** | 新工具 + transport 扩展 | 独有差异化能力（自有文本入图谱/稿件检查） | 1–1.5d | v0.4.0 |

---

## 4. 详细设计

### P0 · `pubmed_pubtator_search` —— 语义/关系搜索

**端点**：`GET https://www.ncbi.nlm.nih.gov/research/pubtator3-api/search/?text={query}&page={n}`

**支持查询形态**（来自官方文档）：

| 形态 | 示例 |
|---|---|
| 自由文本 | `breast cancer` |
| 实体 ID | `@CHEMICAL_remdesivir` |
| 布尔组合 | `@DISEASE_COVID_19 AND @GENE_PON1`、`(... AND ...) OR ...` |
| 关系式 | `relations:ANY\|@CHEMICAL_Doxorubicin\|@DISEASE_Neoplasms` |
| 关系式（对类型） | `relations:ANY\|@CHEMICAL_Doxorubicin\|DISEASE` |

**工具签名（schema 草案）**：

```js
register('pubmed_pubtator_search', '…', {
  query: { type: 'string', required: true, description: 'Free text, entityId (@CHEMICAL_x), boolean, or relation query (relations:treat|@CHEMICAL_X|DISEASE)' },
  page: { type: 'integer', description: 'Page number (default 1)', default: 1 },
  // 关系查询便捷参数：给出后内部拼装 relations: 语法，免手写管道符
  relationType: { type: 'string', enum: ['treat','cause','cotreat','convert','compare','interact','associate','positive_correlate','negative_correlate','prevent','inhibit','stimulate','drug_interact'] },
})
```

**实现要点**：

- [x] 走 `pubtatorScheduled`（P3.1 新队列），禁用共用 ncbiScheduled
- [x] 解析返回 JSON → `{ articles: [{pmid, pmcid, title, journal, date, authors[≤3], doi, score, snippet}], page, pageSize, totalCount, totalPages, facets{year/journal/type top5} }`（✅ 已实测，见 §8 Q1；`text_hl` 的 `<m>` 高亮标签已剥离进 snippet）
- [x] `relationType` + `e1`/`e2` 便捷参数拼装（`e2` 缺省为 `ANY`；拼装后的 query 经 `qs()` 全量 `encodeURIComponent`）
- [x] `pubmed_pubtator_entity_id` 的描述里补一句"拿到 @ID 后可用本工具检索"

**验收标准**：

- [x] 四种查询形态各一条冒烟用例通过（`test/pubtator-search-test.mjs`，21 项断言全过）
- [x] 关系查询返回的文章可被 `pubmed_graph_add` 消化（✅ 真机闭环：`relations:treat|@CHEMICAL_Doxorubicin|DISEASE` → 36,347 命中 → 3 篇 fetch → autoGraph +182 节点/+3534 边）
- [x] 限速场景无 429（✅ 真机抽查：3 个 PubTator 调用并发发出，队列串行化后全部成功）

**真机热修（v0.3.1）**：host 框架在 schema 层校验 `required: true`，导致便捷参数调用（不带 `query`）
在进入工具前被拒。修复：`query` 改为可选（`relationType + e1` 存在时），运行时校验兜底
（无 query 且无关系参数 → 报 "No query provided"）。测试补 T2 回归（不带 query 属性）。

**典型组合流**：`entity_id`（文本→@ID）→ `pubtator_search`（@ID/关系→文章）→ `fetch_articles` → `graph_add`（证据入图）

### P1b · annotate 支持 PMCID

**决策**：方案 A——扩展 `pubmed_pubtator_annotate`，**不新增工具**（README 表格改动小、工具数不膨胀）。

**端点**：`GET /publications/pmc_export/biocjson?pmcids=PMC7696669,PMC8869656&full=true`

**schema 变更**：

```js
{
  pmids:   { type: 'array', items: { type: 'string' }, description: '与 pmcids 二选一' },
  pmcids:  { type: 'array', items: { type: 'string' }, description: 'PMCID（自动补 PMC 前缀），与 pmids 互斥' },
  full:    { type: 'boolean', default: false },
}
```

**实现要点**：

- [x] `pmids` / `pmcids` 互斥校验，二者皆空报错
- [x] PMCID 规范化：`^pmc\d+$/i` 匹配补全大写前缀
- [x] 路由到 `/publications/pmc_export/biocjson`
- [x] 描述同步更新（pmcids + 与 fetch_fulltext 的配合说明）

**验收标准**：

- [x] pmcids 检索返回标注（`full:true` 全文路径透传）
- [x] 参数冲突/皆空报错信息清晰（`pubtator-test.mjs` B4：7 项断言全过；真机验收待重装后抽查）

### P1a · 关系证据回查 + 图谱边证据

**新工具 `pubmed_pubtator_relation_evidence`**：

```js
register('pubmed_pubtator_relation_evidence', '…', {
  e1:   { type: 'string', required: true,  description: 'Entity ID, e.g. @GENE_JAK1' },
  type: { type: 'string', enum: [/* 13 种关系 */] },
  e2:   { type: 'string', description: '另一实体 ID 或实体类型（DISEASE 等）' },
  maxArticles: { type: 'integer', default: 10 },
})
```

- 内部拼装 `relations:{type}|{e1}|{e2}` 走 P0 的 search API，返回 `{ pmid, title, snippet }[]`。

**图谱增强（`mergeGraph`）**：

- [ ] relation 边可选携带 `detail: { evidencePmids: string[] }`，**默认开但每边限量 ≤5 条**
  （config `PUBTATOR_EDGE_EVIDENCE: false` 可关；证据来自对关系对的 search 查询，仅对
  `publications ≤ 50` 的低证据边回查，避免对 treat-neoplasms 这类超粗粒度边刷请求）
- [ ] 回查请求走 `pubtatorScheduled` 且受探测上限约束（与 P3.4 的 probe 配额共享）

**验收标准**：

- [ ] 工具返回某具体关系对的支持文章列表
- [ ] `graph_get` 输出中 relation 边带 evidencePmids
- [ ] `PUBTATOR_EDGE_EVIDENCE:false` 时边结构与 v0.2.1 完全一致（向后兼容）

### P2 · `pubmed_pubtator_annotate_text` 原始文本标注

**端点（两步异步）**：

1. `POST https://www.ncbi.nlm.nih.gov/CBBresearch/Lu/Demo/RESTful/request.cgi`
   `body: text={文本}&bioconcept={类型}` → 返回 session id
2. `POST …/retrieve.cgi` `body: id={session}` → 未就绪时返回 **404 + "[Warning] : The Result is not ready"**，需轮询

**前置改造（transport 扩展）**：

- [ ] `httpGet` 之外新增 `httpPost(url, formBody, signal, timeoutMs)`，同样支持代理回退
- [ ] 注入点同步：`lib/index.js` 与 `lib/dynamic-wrapper.js` 两处 deps 均加 `httpPost`

**工具签名（草案）**：

```js
register('pubmed_pubtator_annotate_text', '…', {
  text: { type: 'string', required: true, description: '待标注原文（建议 ≤ 50k 字符）' },
  bioconcept: { type: 'array', items: { type: 'string', enum: ['Gene','Disease','Chemical','Variant','Species','CellLine'] }, description: '标注的实体类型，默认全部' },
  timeoutMs: { type: 'integer', default: 60000, description: '轮询总时长上限' },
})
```

**实现要点**：

- [ ] 轮询退避：1s 起步、指数退避（×1.5，上限 5s），到 `timeoutMs` 报"标注未完成，session=xxx 可稍后重试"
- [ ] 尊重 `exec.signal` 取消；客户端放弃即结束（服务端无取消 API）
- [ ] 结果沿用 `parsePubtatorBiocJson` 兼容解析（返回格式实测后定）
- [ ] 复用 P3.3 的会话缓存（文本哈希为 key）

**验收标准**：

- [ ] 提交→轮询→取回全链路成功（真实 API 冒烟）
- [ ] 轮询超时给出可恢复的错误（含 session id）
- [ ] signal 取消后不留挂起 promise

### P3 · 打磨项

| # | 内容 | 说明 |
|---|---|---|
| P3.1 | **限流队列分离** | 新增 `pubtatorScheduled`（固定 gap 350ms，≈2.8 req/s < 3 req/s），所有 PubTator 域名调用迁移过去；E-utilities 队列不动。**P0 前置** |
| P3.1b | BUG-2 | `defaultExtractPubtatorRelations` 改为先过滤文内边、后截断 |
| P3.2 | annotate 分批 | >100 PMID 自动按 100 分批串行（pubtatorScheduled 排队），合并结果并返回 `batchCount` |
| P3.3 | 缓存统一 | `defaultExtractPubtator` 的 per-pmid 缓存提升为 core 级，`pubmed_pubtator_annotate` 工具共用（同会话同 PMID 只拉一次） |
| P3.4 | 探测策略化 | `mergeGraph` 关系探测：概念按 disease > chemical > gene > variant 排序后取前 N（config `PUBTATOR_RELATION_PROBE`，默认 3，上限 6）；annotate 超时 60s 与建图路径 30s 统一为常量 |

## 5. 里程碑

| 版本 | 内容 | 出口条件 |
|---|---|---|
| **v0.3.0** | ✅ P3.1 + P0（P1b 移至 v0.3.2） | 新工具冒烟通过（20/20 断言）；README/README_EN 工具表更新（19→20） |
| **v0.3.1** | ✅ P0 真机验收完成 + schema 热修（query 可选） | 真机闭环（关系搜索→建图 +182 节点）与限速抽查通过；21/21 断言 |
| **v0.3.2** | ✅ P1b（pmcids）+ P3.6 路由描述与 SKILL.md | B4 测试 7 项全过；README 中英更新；技能文件随包分发 |
| **v0.3.3** | ✅ P1a（evidence 参数改设计）+ P3.2–P3.5 + P3.7（dryRun 合并 / nlp 懒加载） | 全套 10/10 测试过（新增 ~20 断言：evidence/分批/缓存/自环/空ID/优先级/dryRun）；图谱边证据默认开且 `PUBTATOR_EDGE_EVIDENCE:false` 完全向后兼容 |
| **v0.4.0** | P2（含 transport POST 扩展）+ 移除已废弃的 extract_keywords | 两步异步全链路 + 超时/取消测试通过 |

## 6. 测试计划

沿用 `test/*.mjs` 独立脚本风格（真实 API 冒烟 + 可 offline 跑的结构断言）：

| 文件 | 覆盖 |
|---|---|
| `pubtator-search-test.mjs`（新） | 四种查询形态、分页、便捷参数拼装、错误输入 |
| `pubtator-test.mjs`（扩） | pmcids 路由、>100 分批、互斥校验 |
| `pubtator-text-test.mjs`（新，v0.4.0） | 两步异步、轮询超时、取消 |
| `graph-test.mjs`（扩） | relation 边 evidencePmids、`PUBTATOR_EDGE_EVIDENCE:false` 兼容 |
| `d-fallback-test.mjs`（扩） | PubTator 全挂时新工具报错清晰、建图静默降级不中断 |
| `autograph-test.mjs`（扩） | P3.4 探测策略后的节点/边计数断言 |

## 7. 风险与约束

- **限速 3 req/s**：所有新调用必须走 `pubtatorScheduled`；P0/P1a 会显著增加请求数，探测/证据回查都要有配额上限。
- **search API 无官方 response schema**：输出结构以实测为准（§8 Q1），解析层对字段缺失保持宽容（现有 `String(x || '')` 风格延续）。
- **annotate_text 的 bioconcept 取值范围官方未列全**：schema 先按 6 类给 enum，实测后修正（§8 Q2）。
- **POST 属于 transport 变更**：影响 `index.js` / `dynamic-wrapper.js` 两处注入，需同步修改并回归 dynamic 模式（无 node:fs 场景）。
- **向后兼容**：图谱节点/边结构只增不改；新增 config 项均有保守默认值。

## 8. 待实测 / 待决策（Open Questions）

| # | 问题 | 建议 |
|---|---|---|
| ✅ Q1 | search API 返回 JSON 的确切结构（官方文档未给出） | **已实测（2025-06，Tavily 云端提取）**：DRF 分页 JSON —— `{ results: [{ _id, pmid(number), pmcid?, title, journal, authors[], date, doi?, meta_date_publication, score(number), text_hl(含 <m> 高亮), citations?{NLM,BibTeX} }], facets: { facet_fields: { journal/type/year: [{name, value}] } }, page_size(=10), current, count, total_pages }`。关系式查询同构；schema 已固化进 `pubmed_pubtator_search` 解析器注释 |
| Q2 | annotate_text 的 `bioconcept` 实际支持取值 | 实测逐类验证，修正 enum |
| Q3 | pmc_export 走方案 A（扩展 annotate）还是新工具 | **建议方案 A**（见 P1b） |
| Q4 | 图谱边证据默认开还是关 | 建议默认开、每边 ≤5 条、仅低证据边回查，config 可关 |
| Q5 | annotate_text 文本长度上限 | 官方未写；实测 50k/200k 字符行为后写进 description |

## 9. 明确不做（Out of Scope）

- **FTP 全库批量下载**：GB 级数据，与插件轻量定位不符（文档里给链接即可）。
- **BioC-XML / pubtator 格式导出**：biocjson 已满足全部下游需求，避免格式膨胀。
- **网页端专属功能**（收藏 playlist、在线可视化）：无公开 API 支撑。
- **关系方向性/置信度修正**：官方 API 不提供，不做二次推断。
