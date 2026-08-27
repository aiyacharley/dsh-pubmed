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

### 方式一：复制粘贴给 Agent 自动安装（推荐 · 当前会话立即生效）

把下面**整段**（含所有代码块标记）复制到任意 DSH web 会话发送，Agent 会自动定位 `dsh-pubmed`、
用 `cordis_define` 定义并激活插件、再自测。无需手动改配置、无需重启。

> 需要会话具备 Cordis 动态插件工具（`cordis_define` / `cordis_run` / `cordis_inspect_self`，
> 一般在 `cordis` agent 预设中可用）。

````text
【请帮我安装 dsh-pubmed 插件（PubMed 检索，11 个工具）】

1) 先定位 dsh-pubmed 包目录：即包含 lib/pubmed-core.js 的目录。若你不知道路径，先问我，或在我的工作区 / 用户目录下搜索 "pubmed-core.js"。
2) 用 cordis_define 新建动态插件（idPrefix 随意，如 pmbd），code.host 用下面的包装器，并把两处占位符替换为实际路径：
   - <DSH_PUBMED_CORE_PATH> → lib/pubmed-core.js 的绝对路径（Windows 用正斜杠）
   - <DSH_PUBMED_DIR> → dsh-pubmed 包目录（作为 curl 子进程的工作目录，任意存在目录即可）
3) cordis_run 激活（mode=run）。
4) 验证：调用 pubmed_spell_check({query:"microbiom"}) 应返回 corrected="microbiome"；再调用 pubmed_search_articles 确认搜索可用。若失败，用 cordis_inspect_self 读取诊断并修复后重试。

包装器（code.host）：
```js
return {
  name: 'pubmed-dsh',
  inject: ['timer'],
  async apply(ctx) {
    const fs = ctx.get('fs')
    if (fs === undefined) throw new Error('fs service unavailable')
    const target = await fs.resolve('<DSH_PUBMED_CORE_PATH>')
    const source = await fs.readText(target)
    const factory = new Function(source + '\n; return registerPubmedTools')
    const registerPubmedTools = factory()
    const sub = ctx.get('subprocess')
    const curlGet = async (url, signal, timeoutMs) => {
      if (sub === undefined) throw new Error('subprocess service unavailable')
      const sec = Math.max(5, Math.ceil((timeoutMs || 45000) / 1000))
      const h = sub.spawn({
        argv: ['curl', '-sS', '-L', '--compressed', '-m', String(sec), '-A', 'Mozilla/5.0 (compatible; dsh-pubmed/1.0)', '-w', '\n__DSH_STATUS__%{http_code}', url],
        cwd: '<DSH_PUBMED_DIR>',
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
````

> 想重启后所有会话都自动可用？用上面的「方式二」让 Agent 持久化安装，或下面的「方式三 / 方式四」手动持久化安装。

### 方式二：复制粘贴给 Agent 自动安装（持久化 · 重启后全会话可用）

把下面**整段**（含所有代码块标记）复制到任意 DSH web 会话发送，Agent 会直接修改 DSH profile 的
配置文件并安装依赖；**重启 DSH 后**所有会话都能用：

````text
【请帮我持久化安装 dsh-pubmed（重启后所有会话可用）】

1) 找到 DSH profile 目录（如 C:\Users\<用户名>\.dsh\profiles\web 或 ~/.dsh/profiles/<名称>；不确定就先问）。
2) 编辑该 profile 目录的 package.json：在 dependencies 中加入
   "dsh-pubmed": "github:aiyacharley/dsh-pubmed"
3) 编辑该 profile 目录的 cordis.patch.yml：在顶层 YAML 数组追加（保留原有条目）：
   - insert:
       - id: pubmed
         name: 'dsh-pubmed'
4) 在该 profile 目录运行 npm install（拉取 GitHub 依赖；网络受限就告诉我）。
5) 提示用户重启 DSH。重启后 pubmed_* 工具出现在所有会话。
6) 不要重复：不要把 dsh-pubmed 再加进 dsh.profile.bundles，以免重复挂载。
````

> 需要 Agent 能读写 profile 目录（通常在用户主目录下、会话工作区之外，Agent 可能需要请求文件权限）。

### 方式三：作为 DSH profile bundle 安装（重启后全会话可用）

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

### 方式四：手动挂载（不装包，直接改 patch）

在 profile 的 `cordis.patch.yml`（用户 patch 层）中插入：

```yaml
- insert:
    - id: pubmed
      name: 'dsh-pubmed'
```

并把 `dsh-pubmed` 放入该 profile 可解析的 `node_modules`（或 flat `profiles/node_modules`）后重启。

### 方式五：会话级动态插件（不重启，仅当前会话）

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

> 动态插件沙箱没有 `fetch`，故方式五用 curl 子进程做传输；bundle 方式（二/三/四）直接用 Node `fetch`。

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
