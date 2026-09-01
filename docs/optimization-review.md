# dsh-pubmed · 优化意见评审与执行计划（P4 系列）

| 项 | 内容 |
|---|---|
| 状态 | 评审完成，待按批次执行 |
| 日期 | 2026-09-01 |
| 评审对象 | 外部优化意见 20 项（四大类），逐条对照 `lib/pubmed-core.js`（2188 行 / 110.7KB）、`lib/index.js`、`lib/nlp.js`、`cordis.patch.yml`、`package.json`、README 核实 |
| 结论速览 | **16 项属实采纳、3 项属实但降级缓议、1 项需实测核实**；原始评级有 4 处需要修正（详见各表"复核"列） |
| 关联 | 主线计划见 [`pubtator3-plan.md`](pubtator3-plan.md)；本文件为 P4 系列（代码质量/文档/工程化） |

---

## 1. 总评

这份意见整体质量高：行号引用基本精确（如 2188 行 / 110.7KB 与实测完全一致），20 项中 19 项经代码核实属实。最有价值的是 **二.1（AUTO_GRAPH 批量超时）**——这是真实会在 20 篇以上批量场景咬人的 P0，评审的算术复核无误。

需要修正的 judgment 有四处：二.2（sessionKey 隔离）被真机证据降级（真实运行时 `exec.agent.id` 存在，dryRun 输出的 `session-befbeda1-…` 即为证）；一.3（STOPWORDS）与一.4（normArgs）是真实的但属于美化级；三.5（e2 大小写）两处语义本就不同且实测各自可用；一.6（ESM 化大步）低估了动态模式的约束（`new Function` 是沙箱无模块加载下的刻意设计）。

## 2. 逐条核对

### 2.1 代码精简优化

| # | 原文声明 | 核实结果 | 复核后优先级 | 处置 |
|---|---|---|---|---|
| 一.1 | 双重限速：search_articles(827)/convert_ids(1094)/find_related(1094) 各调一次 `ncbiPace()`，叠加队列 gap 吞吐减半 | ✅ **属实**。`ncbiPace`（163 行）= 无条件 `sleep(NCBI_GAP_MS)`；队列对后续调用再等一个 gap → esearch→esummary 实际 700ms。三处调用点逐一确认 | **P1 采纳** | 删除三处 `ncbiPace()`（队列已保证间距），批次一 |
| 一.2 | `RELATION_VERB_RE`（1691）死代码；动词表 core/nlp.js 两份且漂移（core 19 原形，nlp.js 词干版多 aggravate/govern/shape/predict/stratify/disrupt/trigger） | ✅ **属实**。`RELATION_VERB_RE` 全文件仅定义行一处、零引用；两份动词表内容确实不同 | **P1 采纳** | 删死常量；抽共享词干表（批次一）。注意依赖方向：core 不能 import 可选注入的 nlp.js → 共享常量放 core，nlp.js 从 core 反查不可行 → **放 `lib/constants.js`** 由双方引用，或 nlp.js 保留超集、core 正则由其派生（批次一定方案） |
| 一.3 | STOPWORDS 双份（core:1652 / nlp.js:16），必然漂移 | ✅ **属实**（两份内容近似但已略有差异） | **P3 缓议** | 与一.2 同方案（constants.js）；单独做收益低，随批次一顺手 |
| 一.4 | "schema 默认值不自动生效"防御代码散落，建议 `normArgs` 助手 | ⚠️ **部分属实**：带该注释的实测 2 处（1060/2108），散落的 `args.x \|\| default` 模式更多（search.page / relations.limit / annotate 等）；评审的"至少 4 处注释"高估 | **P3 缓议**（原 P1 高估） | 纯代码美化，改动面大（几乎所有工具）；随批次二顺手做，不单独立项 |
| 一.5 | 配置解析不统一：`!!cfg.X`（YAML 字符串 `"false"` 会被误开）vs 字符串比较 vs 显式比较三种写法 | ✅ **属实且含真 bug**。index.js:147 `!!cfg.AUTO_GRAPH` → `cfg.AUTO_GRAPH: "false"` 误开；P3.8 的 `SKILL_DOC` 检查（同文件）混用同款 | **P1 采纳** | `parseBool(v)` 助手统一四处（AUTO_GRAPH/PUBTATOR/PUBTATOR_EDGE_EVIDENCE/SKILL_DOC），批次一。**P3.8b BASE_URL 前必须先修** |
| 一.6 | 2188 行单文件 + `new Function` 字符串求值（eval 类），建议两阶段：小步抽 citations.js，大步真 ESM | ✅ **属实**（2188 行/110.7KB 实测；new Function 在 index.js:168 与 dynamic-wrapper.js:16） | **P2**（原评级合理，但大步方案需修正认知） | 小步（citations.js 抽取 ~250 行纯函数）：批次二采纳。**大步缓议**：`new Function` 是动态模式沙箱（无模块加载能力）的刻意设计，ESM 化需先验证动态模式 `import()` 可行性——风险高于收益，挂起待 DSH 侧评估 |

### 2.2 功能流程

| # | 原文声明 | 核实结果 | 复核后优先级 | 处置 |
|---|---|---|---|---|
| 二.1 | **AUTO_GRAPH+PUBTATOR 批量超时（P0）**：mergeGraph 每篇 1 次单 PMID 标注调用 + 探测若干，200 篇 ≈ 1200 次 × 350ms ≈ 7 分钟 >> 60s 工具超时 | ✅ **属实，算术复核无误**。`defaultExtractPubtator` 确为逐篇单 PMID 调用（未复用 annotate 的分批）；`timeoutMs: 60000` 全工具统一（747 行确认）；且 P3.8 的证据回查每篇再 +2 次——**实测 20 篇已近 42s，逼近超时线** | **P0 采纳（本系列最高优先）** | ① `mergeGraph` 批量化：同批 PMID 合并成 `export/biocjson?pmids=a,b,c`（100/批，复用 annotate 封装）→ 200 篇从 200 次降到 2 次；② 探测/证据预算随批量缩放（如每批只探测前 N 篇）；③ 超时按工具分级（register 增 per-tool timeoutMs 参数）。批次一 |
| 二.2 | sessionKeyOf 依赖 `exec.agent.id`，真实运行时若无则全落 'default'，会话隔离失效 | ⚠️ **属实但已有反证**：真机 dryRun 输出 `sessionKey: "session-befbeda1-da6e-4905-…"` 证明真实 DSH 运行时 exec 携带 agent.id（即 session-uuid），隔离实际生效 | **P3 硬化**（原 P0 高估——真机证据降级） | 回退链 `agent?.id ?? sessionId ?? requestId ?? 'default'` 可做；README/SKILL 标注前提；批次三顺手 |
| 二.3 | fetch_fulltext 描述"exactly one group"但运行时无互斥校验 | ✅ **属实**。schema 三组全可选、无互斥检查，运行时按序处理 | **P1 采纳** | 运行时校验互斥（二选一皆空/多选报错），或改描述为"按 pmid→pmcid→doi 顺序处理"；批次一（一行校验） |
| 二.4 | Europe PMC 调用无重试（withNetRetry 只包 NCBI/PubTator 队列） | ✅ **属实**（P3.8 实现时 epmSearchRaw/jsonGet 为直连） | **P1 采纳** | EPM 调用复用 `withNetRetry`（仅网络类错误）；批次二 |
| 二.5 | saveUserGraph 直接 writeFileSync 覆盖，崩溃留半写 JSON；commit 无锁 | ✅ **属实**（index.js writeFileSync 确认） | **P1 采纳** | 临时文件 + rename 原子写；批次二 |
| 二.6 | isConcurrencySafe 全返回 true，图写入类工具并发可交错（mergeGraph 中间 await） | ✅ **属实**（register() 748 行对全部工具返回 true） | **P2 采纳** | 按会话 promise 链串行化图写入（复用队列手法）；批次二 |
| 二.7 | lookup_citation 用 `c.key \|\| 'c'+i` 建 Map，重复 key 后者覆盖前者 | ✅ **属实**（947-948 行确认） | **P3 缓议**（原 P2 降级） | 内部唯一索引对齐、key 仅透传；批次三 |

### 2.3 调用说明

| # | 原文声明 | 核实结果 | 复核后优先级 | 处置 |
|---|---|---|---|---|
| 三.1 | cordis.patch.yml 注释仍写 "11 model tools" 且只列 11 个 | ✅ **属实**（已发布 npm 包内逐字确认；实际 20 个） | **P1 采纳** | 更新注释为 20 工具全名单；批次一（一分钟） |
| 三.2 | README 配置表列了代码不存在的 `NCBI_ADMIN_EMAIL`（硬编码于 core:30，无读取逻辑）与 `EUROPEPMC_ENABLED`（全库零引用） | ✅ **属实**（lib/ 全库 grep 零匹配确认） | **P1 采纳** | `NCBI_ADMIN_EMAIL`：实现为 cfg/env 一行注入 `NCBI_EMAIL`（顺带符合 NCBI 合规建议）；`EUROPEPMC_ENABLED`：实现为 EPM 双工具注册门控（一行），或从文档删除——**建议实现**；批次一 |
| 三.3 | patch 配置格式矛盾：index.js 注释写 `- override: { id, config }`，README 强调裸对象 `{ id, config }`；同 id 的 bundle 行 + config 行是合并还是冲突未说明 | ⚠️ **属实，需实测核实**。README 的裸对象写法来自作者实战；index.js 注释疑为上游残留。DSH cordis patch 合并语义需对照源码/双格式实测 | **P2 核实** | 批次二：双格式各建测试 profile 实测 → 统一文档（index.js 注释 + README + SKILL）→ 明确同 id 行为 |
| 三.4 | @ 前缀含糊：entity_id 返回带 @（实测确认），search/relations 装配时不归一化缺 @ 的输入 | ✅ **属实**。修复便宜：装配关系式时 `x.startsWith('@') ? x : '@' + x` | **P1 采纳** | 批次二 + 文档写明"entity_id 输出 → search/relations 输入"转换规则 |
| 三.5 | e2 大小写不一致：relations enum 小写、search 示例大写 | ⚠️ **属实但两者语义不同**：relations 的 e2 是 schema enum（小写），search 的 e2 是关系式自由文本（官方文档用大写 DISEASE）——实测各自可用 | **P3 文档**（原 P1 降级） | 文档注明两处大小写约定；不改代码 |
| 三.6 | SKILL.md 缺工具速查表/配置项/易错点 | ✅ **属实** | **P2 采纳** | 批次二扩充；注意自注册机制会让内容随版本自动传播，值得投入 |
| 三.7 | wechat 推广文仍是"11 个工具" | ✅ **属实**（父目录文件确认，不属 dsh-pubmed 仓库） | **P3 站外** | 营销文案编辑事务，与仓库发布解耦 |
| 三.8 | 工具描述路由语句措辞/大小写不一 | ✅ **属实** | **P3 顺手** | 批次三 |

### 2.4 工程化

| # | 原文声明 | 核实结果 | 复核后优先级 | 处置 |
|---|---|---|---|---|
| 四.1 | 无 scripts、无 lint、CI 不跑测试 | ✅ **属实**（package.json scripts = null 确认） | **P1 采纳** | `npm test`（全离线套件）/ `test:offline` / `smoke`；release.yml 加测试前置步骤；批次一（脚手架）+ 批次二（lint 选型） |
| 四.2 | npm files 缺 docs/ → README 链接 npm 包内 404 | ✅ **属实**（白名单确认无 docs） | **P1 采纳** | `files` 加 `"docs"`；批次一（一行） |
| 四.3 | CHANGELOG.md 不存在，计划书却列为涉及文件 | ✅ **属实**（dsh-pubmed 仓库无此文件；计划书提法源自原项目上下文） | **P3** | 抽 Keep a Changelog 格式（README 版本历史迁移过去）或删计划书引用；批次三 |
| 四.4 | sessionGraphs Map 永不淘汰，长会话内存增长 | ✅ **属实**（真实但边缘：会话隔离 + DSH 重启即清） | **P3 缓议** | 容量上限/淘汰策略；批次三 |

## 3. 修正后的执行批次

| 批次 | 版本 | 内容 | 工作量 |
|---|---|---|---|
| **批次一** | v0.3.7 | **P0 二.1**（mergeGraph 批量化 + 探测/证据预算缩放 + 超时分级）+ 一.1（删 ncbiPace×3）+ 一.2（死代码/共享动词表）+ 一.5（parseBool，修 YAML "false" 误开 bug）+ 三.1（patch 注释）+ 三.2（幽灵配置：实现 NCBI_ADMIN_EMAIL + EUROPEPMC_ENABLED 门控）+ 二.3（fulltext 互斥校验）+ 四.2（files 加 docs） | ~1d |
| **批次二** | v0.3.8 | 二.4（EPM 重试）+ 二.5（原子写）+ 二.6（图写串行化）+ 三.4（@ 归一化）+ 三.6（SKILL.md 扩充）+ 四.1（lint 选型）+ 一.6 小步（citations.js） | ~1d |
| **批次三** | v0.4.0 随 P2 / 缓议 | P3.8b + P2 本体 + 三.3（patch 语义实测）+ 一.3（STOPWORDS 随 constants.js）+ 一.4 + 二.2 硬化 + 二.7 + 四.3 + 四.4 + 三.5/三.8 | 随 P2 |

## 4. 有争议/需实测事项

1. **patch 配置语义（三.3）**：裸对象 vs `- override:` 包装、同 id bundle 行与 config 行的合并/冲突——需在测试 profile 双格式实测，并对照 DSH cordis 源码后统一文档。这是用户最容易被卡住的点，核实前不做任何"想当然"的修改。
2. **一.6 大步 ESM 化**：`new Function` 是动态模式沙箱（无模块加载）的刻意约束。大步方案的前提是验证动态插件可 `import()`——若不可行，保留 boot.js 收拢方案即可，不值得为纯 ESM 破坏动态模式。
3. **一.3/一.2 共享常量的依赖方向**：core 不能 import 可选注入的 nlp.js（nlp 是被注入方）。共享常量需要第三个无依赖文件（lib/constants.js）或接受"nlp.js 为超集、core 由其派生"——批次一定稿。

## 5. 与主线计划的关系

- 本文件为 **P4 系列**（质量/工程化），独立于 [`pubtator3-plan.md`](pubtator3-plan.md) 的 P0–P2 功能主线。
- 批次一与主线无冲突（mergeGraph 批量化与 P1a 证据回查兼容——批量后预算按批分配）。
- 已在主线计划 §3 添加指针。
