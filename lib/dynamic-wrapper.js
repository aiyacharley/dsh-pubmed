// dynamic-wrapper.js —— 动态插件包装器模板（作为 cordis_define 的 code.host）。
//
// 用法：用 cordis_define 新建动态插件时，把本文件内容作为 code.host，
// 并把两处占位符替换为实际路径：
//   <DSH_PUBMED_CORE_PATH> → dsh-pubmed/lib/pubmed-core.js 的绝对路径（Windows 用正斜杠）
//   <DSH_PUBMED_DIR>       → dsh-pubmed 包目录（作为 curl 子进程的工作目录）
// 然后 cordis_run 激活即可。动态沙箱无 fetch，故用 curl 子进程做 HTTP 传输。
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
