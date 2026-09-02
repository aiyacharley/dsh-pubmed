#!/usr/bin/env node
/**
 * scripts/sync-mirror.mjs — E1（出处：dsh-ai4scholar scripts/sync-mirror.mjs，MIT）。
 * 发布后主动请求 npmmirror（registry.npmmirror.com，国内默认源）立刻同步本包，
 * 并轮询确认刚发布的版本已可见。挂 release.yml 的 publish 步骤之后
 * （等价于 npm 的 postpublish 生命周期）。镜像抖动只打印提示，绝不失败发布。
 *
 * 实现注记：不用 AbortSignal.timeout（其句柄在 Windows 上与 process.exit 竞争，
 * libuv 断言崩溃 exit 0xC0000409）——用显式 AbortController + clearTimeout，
 * 且全程不用 process.exit，以 process.exitCode 自然退出。
 *
 * 手动运行：node scripts/sync-mirror.mjs   （读 package.json 的 name/version）
 */
import { readFileSync } from 'node:fs'

const MIRROR = 'https://registry.npmmirror.com'
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const { name, version } = pkg
const deadline = Date.now() + 5 * 60_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function json(url, init) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error('timeout')), 20_000)
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  } finally {
    clearTimeout(timer)
  }
}

async function mirrorHas() {
  const { body } = await json(`${MIRROR}/${name}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } })
  return body?.versions !== undefined && version in body.versions
}

async function main() {
  try {
    if (await mirrorHas()) {
      console.log(`npmmirror already has ${name}@${version}`)
      return 0
    }
    const { body: task } = await json(`${MIRROR}/-/package/${name}/syncs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skipDependencies: true }),
    })
    console.log(`npmmirror sync requested for ${name}@${version}: task ${task?.id ?? '?'} (${task?.state ?? '?'})`)
    while (Date.now() < deadline) {
      await sleep(5_000)
      if (await mirrorHas()) {
        console.log(`npmmirror now serves ${name}@${version}`)
        return 0
      }
      if (task?.id !== undefined) {
        const { body: status } = await json(`${MIRROR}/-/package/${name}/syncs/${task.id}`)
        if (status?.state === 'fail') {
          console.log(`npmmirror sync task failed: ${status?.error ?? 'unknown'} — it will pick the version up on its own schedule.`)
          return 0
        }
      }
    }
    console.log(`npmmirror has not surfaced ${name}@${version} yet; users can pass --registry https://registry.npmjs.org meanwhile.`)
  } catch (error) {
    console.log(`npmmirror sync skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
  return 0
}

process.exitCode = await main()
