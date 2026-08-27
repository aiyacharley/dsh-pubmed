# dsh-pubmed

**PubMed / Europe PMC 文献检索插件 for DeepSeek Harness (DSH) · v0.1.0**

把 [`@cyanheads/pubmed-mcp-server`](https://github.com/cyanheads/pubmed-mcp-server) 的核心能力
移植成 DSH 原生模型工具：搜索、文章元数据、全文、引用格式化、MeSH、ID 转换等 11 个工具，
直接对接 NCBI E-utilities 与 Europe PMC REST，无需额外的 MCP 客户端配置。

## ✨ 功能（11 个工具）

| 工具 | 说明 |
|---|---|
| `pubmed_search_articles` | PubMed 全文检索（布尔/字段/日期/排序/分页/摘要） |
| `pubmed_fetch_articles` | 按 PMID 获取结构化文章（作者/摘要/MeSH/基金/DOI/PMCID） |
| `pubmed_fetch_fulltext` | PMC 全文（JATS → 分节正文，best-effort） |
| `pubmed_format_citations` | APA 7 / MLA 9 / BibTeX / RIS / Vancouver 引用 |
| `pubmed_find_related` | 相似文献 / 引用 / 参考文献（ELink + ESummary） |
| `pubmed_lookup_mesh` | MeSH 词表（树号 / 范围注释 / 入口词） |
| `pubmed_lookup_citation` | 部分引文 → PMID（ECitMatch） |
| `pubmed_convert_ids` | DOI / PMID / PMCID 互转 |
| `pubmed_spell_check` | 检索词拼写纠正（ESpell） |
| `pubmed_europepmc_search` | Europe PMC 检索（MED/PMC/PPR/PAT/AGR，游标分页） |
| `pubmed_europepmc_fetch` | Europe PMC 单条完整记录（含未截断摘要） |

## 📦 安装

**0. 获取源码**（方式 A 需要本机磁盘上有 `lib/pubmed-core.js`）：

```bash
git clone https://github.com/aiyacharley/dsh-pubmed.git
```

**1. 推荐 · 复制粘贴给 Agent 自动安装**（需 `cordis` 预设的会话）

把下面任一段**整段**贴到任意 DSH web 会话，Agent 会自动完成安装并自测：

- **A · 当前会话立即生效（无需重启）**：

````text
【请帮我安装 dsh-pubmed 插件（PubMed 检索，11 个工具）】
1) 先定位 dsh-pubmed 包目录（含 lib/pubmed-core.js）。若本机还没有，先 git clone https://github.com/aiyacharley/dsh-pubmed.git；找不到就问我。
2) 读取该目录 lib/dynamic-wrapper.js 作为 cordis_define 的 code.host，并把 <DSH_PUBMED_CORE_PATH> 替换为 lib/pubmed-core.js 的绝对路径、<DSH_PUBMED_DIR> 替换为 dsh-pubmed 包目录。
3) cordis_run 激活（mode=run）。
4) 验证：pubmed_spell_check({query:"microbiom"}) 应返回 corrected="microbiome"；失败用 cordis_inspect_self 修复。
````

- **B · 持久化（重启后全会话可用）**：

````text
【请帮我持久化安装 dsh-pubmed（重启后所有会话可用）】
1) 找到 DSH profile 目录（如 C:\Users\<用户名>\.dsh\profiles\web；不确定就先问）。
2) 编辑该目录 package.json：dependencies 加入 "dsh-pubmed": "github:aiyacharley/dsh-pubmed"。
3) 编辑该目录 cordis.patch.yml：顶层 YAML 数组追加（保留原有条目）：
   - insert:
       - id: pubmed
         name: 'dsh-pubmed'
4) 在该目录运行 npm install，然后提示用户重启 DSH。
````

**2. 手动安装（可选）**

- **bundle**：profile 的 `package.json` 加 `"dsh-pubmed": "github:aiyacharley/dsh-pubmed"` 依赖，并在 `dsh.profile.bundles` 加 `"dsh-pubmed"` → `npm install` → 重启。
- **patch**：profile 的 `cordis.patch.yml` 追加上方 B 的 insert 行，确保 `dsh-pubmed` 可被 npm 解析 → 重启。
- **会话级**：手动 `cordis_define` / `cordis_run`（包装器模板见 `lib/dynamic-wrapper.js`）。

## 🗑️ 卸载

- **会话级**（方式 A / 手动会话级）：对该插件执行 `cordis_undefine` 即可；或直接重启 DSH 进程——会话级插件本就不持久，重启即消失。
- **持久化**（方式 B / bundle / patch）：撤销安装时的改动并重启。也可把下面**整段**贴给 Agent 自动卸载：

````text
【请帮我卸载 dsh-pubmed（重启后所有会话不再有 pubmed_* 工具）】
1) 找到 DSH profile 目录（如 C:\Users\<用户名>\.dsh\profiles\web；不确定就先问）。
2) 编辑 package.json：删除 dependencies 中的 "dsh-pubmed"；若 dsh.profile.bundles 里有 "dsh-pubmed" 一并删除。
3) 编辑 cordis.patch.yml：删除 id 为 pubmed 的 insert 块（保留其他条目）。
4) 在该目录运行 npm install（移除已安装的包）。
5) 提示用户重启 DSH。
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
```

## ⚙️ 配置

bundle 运行时无需配置。可选环境变量（加入 profile 的 patch 行 `config.env` 或进程环境）：

| 变量 | 作用 |
|---|---|
| `NCBI_API_KEY` | 提高 NCBI 限流（10 req/s 而非 3 req/s） |
| `NCBI_ADMIN_EMAIL` | NCBI 建议的联系邮箱 |
| `EUROPEPMC_ENABLED` | 控制 Europe PMC 相关工具 |

无 API key 时插件内置 350ms 请求节奏，避免触发 NCBI 429。

## ✅ 要求

- DSH 版本（任意支持 Cordis bundle 的部署）
- Node.js ≥ 20（bundle 使用全局 `fetch`）
- 出网可访问 `eutils.ncbi.nlm.nih.gov` 与 `www.ebi.ac.uk`

## 📄 License

Apache-2.0。功能移植自 [@cyanheads/pubmed-mcp-server](https://github.com/cyanheads/pubmed-mcp-server)
（Apache-2.0，作者 Casey Hand）。
