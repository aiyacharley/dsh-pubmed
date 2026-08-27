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

### 方式一：作为 DSH profile bundle 安装（推荐，重启后全会话可用）

1. **从 GitHub 安装依赖** —— 在 DSH profile 目录（如 `~/.dsh/profiles/web`）的 `package.json`
   `dependencies` 中加入：

   ```jsonc
   "dependencies": {
     "dsh-pubmed": "github:aiyacharley/dsh-pubmed"
   }
   ```

2. **把 `dsh-pubmed` 加进 bundle 栈** —— 同目录 `package.json` 的 `dsh.profile.bundles` 数组：

   ```jsonc
   "dsh": { "profile": { "bundles": [ /* ...已有 bundle... */, "dsh-pubmed" ] } }
   ```

3. **安装依赖并重启 DSH**：

   ```bash
   cd ~/.dsh/profiles/web && npm install
   # 重启 DSH web 应用
   ```

   启动后，11 个工具以 `pubmed_*` 命名出现在**所有会话**中。

> 若发布到 npm，亦可一条命令安装：`dsh plugin --profile <name> add dsh-pubmed@0.1.0`。

### 方式二：手动挂载（不装包，直接改 patch）

在 profile 的 `cordis.patch.yml`（用户 patch 层）中插入：

```yaml
- insert:
    - id: pubmed
      name: 'dsh-pubmed'
```

并把 `dsh-pubmed` 放入该 profile 可解析的 `node_modules`（或 flat `profiles/node_modules`）后重启。

### 方式三：会话级动态插件（不重启，仅当前会话）

本仓库 `dsh-pubmed/lib/pubmed-core.js` 是传输无关的核心；在任意会话用 `cordis_define`
定义如下包装器（`code.host`），即可在**当前进程内**立即可用：

```js
return {
  name: 'pubmed-dsh',
  inject: ['timer'],
  async apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) throw new Error('fs service unavailable')
    const target = await fs.resolve('<绝对路径>/dsh-pubmed/lib/pubmed-core.js')
    const source = await fs.readText(target)
    const factory = new Function(source + '\n; return registerPubmedTools')
    const registerPubmedTools = factory()
    const sub = ctx.get('subprocess')
    const curlGet = async (url, signal, timeoutMs) => {
      if (sub === undefined) throw new Error('subprocess service unavailable')
      const sec = Math.max(5, Math.ceil((timeoutMs || 45000) / 1000))
      const h = sub.spawn({
        argv: ['curl', '-sS', '-L', '--compressed', '-m', String(sec), '-A', 'Mozilla/5.0 (compatible; dsh-pubmed/1.0)', '-w', '\n__DSH_STATUS__%{http_code}', url],
        cwd: '<任意存在的目录>',
        stdio: { stdin: 'ignore', stdout: { maxBytes: 16 * 1024 * 1024 }, stderr: { maxBytes: 262144 } },
        graceMs: 5000,
        signal,
      })
      const out = await h.done
      const stdout = (h.collected.stdout ? h.collected.stdout.readFrom(0).text : '') || ''
      const stderr = (h.collected.stderr ? h.collected.stderr.readFrom(0).text : '') || ''
      if (out.exitCode !== 0) throw new Error('curl failed (exit ' + out.exitCode + '): ' + stderr.trim().slice(0, 300))
      const m = /\n__DSH_STATUS__(\d+)\s*$/.exec(stdout)
      const status = m ? parseInt(m[1], 10) : 0
      const body = m ? stdout.slice(0, m.index) : stdout
      if (status >= 400) throw new Error('HTTP ' + status + ' from ' + String(url).split('?')[0] + ': ' + body.slice(0, 400))
      return { status, body }
    }
    registerPubmedTools(ctx, {
      defineTool: harness.defineTool,
      register: (def) => harness.registerTool(ctx, def),
      httpGet: curlGet,
      sleep: (ms) => ctx.timeout(ms),
    })
  },
}
```

> 动态插件沙箱没有 `fetch`，故方式三用 curl 子进程做传输；bundle（方式一/二）直接用 Node `fetch`。

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
