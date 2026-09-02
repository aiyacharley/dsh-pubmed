# 00 · dsh-pubmed 路线图（主计划书）

> 本文是全项目的**唯一总览**：已完成 / 计划中 / 参考出处。编号约定：
> `00_` 主计划书（本文，所有分册的结论最终汇总于此）；
> `01_`、`02_`、… 按创建顺序递增的分册（专题详细设计）。
> 现有分册：[`01_pubtator3-plan.md`](01_pubtator3-plan.md)（P0–P2 功能主线详细设计）、
> [`02_optimization-review.md`](02_optimization-review.md)（20 项外部优化评审核定）。
> 更新规则：新想法先入本文 §2 再视需要开分册细化；分册完成一项就在本文 §1 打勾并注明版本。

| | |
|---|---|
| 当前版本 | v0.4.1（npm latest）· 25 工具 |
| 下一版本 | v0.4.x：P2 annotate_text（待上游恢复）+ 缓议项按需捞取 |
| 维护原则 | 免费直连（不引入付费代理）；纯 JS 免构建；离线测试全覆盖；发布全自动 |

---

## 1. 已完成（v0.1.0 → v0.4.0）

### 1.1 功能主线（出自 01 分册，P0–P3.9）

| 项 | 内容 | 版本 | 状态 |
|---|---|---|---|
| 基础移植 | 11 个 PubMed 工具（cyanheads 核心能力移植为 DSH 原生工具） | v0.1.x–v0.2.x | ✅ |
| P0 | **PubTator3 语义搜索** `pubtator_search`（自由文本/@实体/布尔/relations: 查询 + facets） | v0.3.0–v0.3.1 | ✅ |
| P1a | 关系证据回查（`relations({evidence:true})` → 支持文献 PMIDs 入边） | v0.3.3 | ✅ |
| P1b | PMCID 标注支持（pmc_export 路由 + 前缀归一化） | v0.3.2 | ✅ |
| P1c | annotate 自动分批（>100 自动切）+ 会话级缓存统一 | v0.3.3 | ✅ |
| P3.1–P3.4 | 限速队列（NCBI 350/120ms + PubTator 350ms 独立队列）、类型优先探测、探测/证据预算 | v0.3.x | ✅ |
| P3.5 | mermaid 图谱卡片（NPG 配色） | v0.3.4 | ✅ |
| P3.6 | `graph_add({dryRun})` 预览（extract_keywords 废弃） | v0.3.3 | ✅ |
| P3.7 | nlp.js 懒加载降级 + 描述互指路由 | v0.3.3 | ✅ |
| P3.8 | **无代理韧性**：网络分类重试（现已 6 次指数退避对齐原版）+ EBI 降级链（search/convert/find_related）+ 可行动报错 | v0.3.5 | ✅ |
| P3.9 | **技能文档自注册**（激活时写 `~/.dsh/skills/`，幂等改写，`SKILL_DOC:false` 可关）+ 发布自动化 workflow | v0.3.6 | ✅ |

### 1.2 质量工程（出自 02 分册，P4 两批次）

| 批次 | 内容 | 版本 | 状态 |
|---|---|---|---|
| 批次一 | **P0 修复：mergeGraph 批量预取**（200 篇 200+ 次调用→2 次）+ 探测/证据预算 + 富集 150s 死线 + httpGet 超时真正生效；ncbiPace 冗余删除；parseBool 修 YAML "false" 误开 bug；constants.js 共享词表；缓存投毒修复；EUROPEPMC_ENABLED / NCBI_ADMIN_EMAIL 落地 | v0.3.7 | ✅ |
| 批次二 | EPM 调用套 withNetRetry；用户图谱原子写（tmp+rename）；图写按会话串行化；@ 前缀自动归一化；SKILL.md 扩充（速查表/配置表/易错点）；npm scripts + CI 测试门 | v0.3.8 | ✅ |
| 清理 | 移除已废弃 `pubmed_extract_keywords`（20→19 工具） | v0.3.9 | ✅ |
| 修复 | CI：npm install 步骤 + 测试门改 continue-on-error（裸 CI 无 node_modules 的教训） | v0.3.8 | ✅ |
| 修复 | **重试预算对齐原版 cyanheads**：2 次固定（4s）→ 6 次指数退避（~61s 跨度，±25% jitter，覆盖 60s 黑洞窗口）；NET_RETRY_RE 扩 HTTP 5xx/429 | 本地已提交 | ✅ |

### 1.3 验证手段

- 离线测试 16/16 文件全绿（批量/预算/门控/互斥/串行化/原子写/降级链/技能注册/E 项/S2/压测 500 篇 70ms）
- 无代理真机复测多轮：20 篇建图 106 概念入图 / 并发 graph_add 串行无交错 / EPM 双通 / @ 归一化
- 发布自动化三连验证：push tag → Actions 测试 → Release 挂 tgz → NPM_TOKEN 自动 publish

### 1.4 生态补全（v0.4.0 已发布）

| 项 | 内容 | 版本 | 状态 |
|---|---|---|---|
| P3.8b | `EUTILS_BASE_URL` / `PUBTATOR_BASE_URL` / `EPMC_BASE_URL` 反代可配（三族 URL 统一收敛为常量，替换全部硬编码点） | v0.4.0 | ✅ v0.4.0 |
| E1 | npmmirror 主动同步（`scripts/sync-mirror.mjs`，发布后国内 1 分钟内可装；release.yml 挂钩，绝不失败发布） | v0.4.0 | ✅ v0.4.0 |
| E2 | `fetch_fulltext` 分页切片（`offset`/`maxCharacters`/`nextOffset`）+ "exactly one group" 互斥运行时强制 | v0.4.0 | ✅ v0.4.0 |
| E3/E4 | `pubmed_search_papers` 双源统一检索：titleKey（NFKC/码点切片 120/短标题 12 守卫）去重合并排序，perSource 报告 | v0.4.0 | ✅ v0.4.0 |
| E5 | Semantic Scholar 直连五工具（`search_s2` / `get_s2_detail` / `get_s2_citations` / `get_s2_recommendations` / `match_paper_by_title`）；`S2_ENABLED` 门控 + 专用限速队列（无 key 3s/次 < 共享 100req/5min，有 key 1.1s/次） | v0.4.0 | ✅ v0.4.0 |
| 测试 | `test/e-items-test.mjs`（E1–E4，13 断言）+ `test/s2-test.mjs`（E5，14 断言） | v0.4.0 | ✅ |
| 文档 | SKILL/README/README_EN/cordis/index.js 同步到 25 工具 + 新配置 + 新路由 | v0.4.0 | ✅ v0.4.0 |

### 1.5 统一搜索增强（v0.4.1 已发布）

| 项 | 内容 | 版本 | 状态 |
|---|---|---|---|
| E3b | `pubmed_search_papers` 默认三源（+**OpenAlex**：快速 ~0.5s、免费、全领域、带被引） | v0.4.1 | ✅ |
| E3c | `sources` 支持 `'s2'`（opt-in Semantic Scholar）与 `'all'`（四源） | v0.4.1 | ✅ |
| E3d | `sort`（relevance/citations/year）+ `year` 跨源过滤（**下推各源查询**：pubmed mindate / EPM PUB_YEAR / OpenAlex from-to_publication_date / S2 year=，修复事后过滤返回 0 条） | v0.4.1 | ✅ |
| 路由 | agent 工具描述补全：`search_articles`/`europepmc_search` 指向统一搜索 | v0.4.1 | ✅ |

---

## 2. 计划中（v0.4.x 及以后）

### 2.1 P2 收官（⏸️ 已搁置，2026-09-02 实测决策）

> **搁置原因（实测坐实）**：PubTator 任意文本标注的两步 RESTful 服务**当前后端故障**——
> `request.cgi` 提交正常（200 + session id），但 `retrieve.cgi` 对一切请求返回通用 400
> HTML 错误页（文档规定未就绪应为 404 + "[Warning] : The Result is not ready"）。
> 已排除调用侧因素：真假 session id、单/多 bioconcept、GET/POST、路径风格、尾斜杠、
> Content-Type 变体全部 400；多轮跨时段复测一致。其余候选路由同样不可用
> （tmTool.cgi 500、`/research/bionlp/` 已 Django 表单化、PTC 文档指向的
> `pubtator-api/annotations` 端点 404）。结论：**上游服务故障，非调用侧问题**。
> 01 分册 §7 风险条款（"SLA 弱于主站"）提前命中。恢复后按 01 分册 §4 P2.0–P2.8
> 原设计实施即可（协议有官方背书，设计不需改动）。

| 项 | 内容 | 出处 | 规模 | 状态 |
|---|---|---|---|---|
| **P2 `pubmed_pubtator_annotate_text`** | 原始文本标注（两步异步 POST + sessionId 轮询续取） | 01 分册 §4 P2.0–P2.8 | 1–1.5d | ⏸️ 搁置（待上游恢复） |
| P3.8b | `PUBTATOR_BASE_URL` / `EUTILS_BASE_URL` 可配置（自建反代口子） | 01 分册 §3 | 0.25d | ✅ 已实现（见 §1.4） |
| transport 扩展 | httpPost（form-urlencoded）+ 轮询器 | 01 分册 §4 P2.2/P2.4 | 随 P2 | ⏸️ 随 P2 搁置 |

### 2.2 生态补全（⭐ 新增，出处：dsh-ai4scholar 仓库逆向学习）

> 参考仓库：`literaf/dsh-ai4scholar`（本地 `../dsh-ai4scholar/`），38 工具付费代理插件。
> **核心洞察：它的 PubMed 全部走 `ai4scholar.net` 自有云端代理，根本不直连 NCBI——这就是"感觉不到黑洞"的真正原因。** 免费直连是 dsh-pubmed 的定位，代理模式不抄；但以下工程模式值得吸收：
>
> **更新：E1–E5 已随 v0.4.0 发布（见 §1.4），下表保留为出处/规模参考。**

| 项 | 内容 | 参考出处（dsh-ai4scholar 源码） | 规模 |
|---|---|---|---|
| **E1 npmmirror 主动同步** | 发布后 `PUT registry.npmmirror.com/-/package/{name}/syncs` + 轮询确认（50 行零依赖，永不失败发布）；国内用户 1 分钟内可装新版。当前腾讯镜像同步延迟是真实痛点 | `scripts/sync-mirror.mjs`（postpublish 挂钩） | 0.5h |
| **E2 fetch_fulltext 切片** | 全文工具加 `offset` / `max_chars` 参数——40 页论文分页读，不冲爆上下文。现状只有 40k 硬截断 | `src/pdf.ts`（read_* 家族的分页模式） | 2h |
| **E3 统一搜索 `pubmed_search_papers`** | 一次查询打 PubMed + Europe PMC 双源，**按 DOI/PMID/规范化标题去重合并**，多平台命中排前，perSource 报告各源成功/失败 | `src/tools/unified.ts`（identityKeys/mergeInto/mergePaperLists 全套模式） | 1d |
| **E4 标题归一化算法** | `titleKey()`：NFKC → 保任意文字字母数字（`\p{L}\p{N}`）→ 按码点切片 120 字符；`MIN_TITLE_KEY=12`——短标题不做标题去重（错误合并比重复更糟）。解决俄语/希腊语/全角/组合字符去重失效的坑 | `unified.ts:81-108`（注释记录了踩坑史） | 随 E3 |
| **E5 Semantic Scholar 直连工具族** | S2 官方 API **免费**（无 key 100 req/5min）。补三个 PubMed 生态缺失能力：**被引数**（PubMed/EPM 均不提供）、**论文推荐**（`/recommendations/v1/papers/forPaper`）、**标题→论文精确匹配**（`/graph/v1/paper/search/match`）。工具建议：`search_s2` / `get_s2_detail` / `get_s2_citations` / `get_s2_recommendations` / `match_paper_by_title` | `src/tools/semantic-scholar.ts`（工具面设计；但我们直连官方 API 而非付费代理） | 1–2d |

### 2.3 缓议项（出自 02 分册批次三 + 会话遗留）

| 项 | 内容 | 状态 |
|---|---|---|
| 一.6 citations.js 抽取 | 受 `new Function` 架构约束缓议（core 无法 import；等 ESM 化大步验证动态插件可行性后再动） | 挂起 |
| 三.3 patch 语义实测 | 裸 `{id,config}` vs `- override:` 的合并冲突行为，需双格式实测 | 缓议 |
| 一.4 normArgs helper | 参数归一化统一 | 缓议 |
| 二.2/二.7 | sessionKeyOf 硬化、lookup_citation key 去重 | 缓议 |
| 四.3/四.4 | CHANGELOG.md、sessionGraphs 内存上限 | 缓议 |
| biome lint | 选型已定（父项目同款），未接入 | 缓议 |
| Web UI 卡片 | 引用卡片/设置卡片（React + tsdown 双构建，架构级）——dsh-ai4scholar 最大差异化，成本最高 | 远期评估 |

---

## 3. 参考出处汇总

| 来源 | 文件/位置 | 借鉴了什么 |
|---|---|---|
| **@cyanheads/pubmed-mcp-server**（本地 `../pubmed-mcp-server/`） | `src/services/ncbi/ncbi-service.ts`（withRetry：6 次指数退避 cap 30s ±25% jitter + 60s 总死线）；`server-config.ts`（maxRetries=6, totalDeadlineMs=60000） | 重试预算参数（P4 已对齐，修复了我们 2 次固定重试的短板） |
| **@cyanheads/pubmed-mcp-server** | 11 个工具的工具面/参数设计 | v0.1.x 移植起点（保留出处声明在 package.json description） |
| **literaf/dsh-ai4scholar**（本地 `../dsh-ai4scholar/`） | `src/tools/unified.ts`、`src/pdf.ts`、`scripts/sync-mirror.mjs`、`src/prompt.ts` | E1–E5 生态补全项（§2.2）；统一 Paper 形状与去重合并模式；镜像同步；系统提示词段落模式 |
| **外部优化评审**（用户提供的 20 项意见） | 02 分册全文 | P4 批次一/二全部工程化改动 |
| **DSH 官方插件生态** | cordis.patch.yml / dsh-tools / 技能文件系统源码 | bundle 挂载、defineTool、技能自注册 root 扫描机制 |
| **真机压测教训** | 本仓库 git log + 会话记录 | 缓存投毒、CI 裸环境、timeout 参数失效、SSH DPI 拦截等实战发现 |

---

## 4. 里程碑

| 版本 | 内容 | 验收 |
|---|---|---|
| **v0.4.1** | **统一搜索增强**：默认三源（+OpenAlex）、S2 opt-in、`sort`/`year`（服务端下推）、agent 路由补全 | 真机验证（year 过滤修复、四源合并、OpenAlex 数据完整）；全套离线测试 16/16 绿 |
| **v0.4.0** | P3.8b（反代可配）+ E1（npmmirror）+ E2（全文分页）+ E3/E4（统一搜索）+ E5（S2 直连）；P2（annotate_text）**因上游故障搁置**，恢复后单独发布 | E1–E5 + P3.8b 均已本地实现（见 §1.4）；全套离线测试 16/16 绿；发布后 npmmirror 1 分钟内可查；P2 待上游恢复后按 01 分册 §4 实施 |
| v0.4.x+ | 缓议项按需捞取；Web UI 卡片立项评估 | — |

## 5. 明确不做

- 付费 API 代理模式（ai4scholar.net 式积分制）——免费直连是本插件的存在理由
- TypeScript / 构建管线迁移——纯 JS 免构建是 GitHub 直装的优势
- 替代 01 分册的详细设计——本文只做总览与状态追踪
