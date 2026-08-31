// pubtator-default-test.mjs — regression tests for the DEFAULT (non-injected)
// PubTator paths introduced by the two prerequisite bug fixes:
//   BUG-2: defaultExtractPubtatorRelations must filter intra-article relations
//          BEFORE applying the per-concept cap of 20, so hub concepts whose
//          relations list is long keep their in-article edges.
//   BUG-1: all pubtator3-api calls run on the dedicated pubtatorScheduled queue
//          (fixed ~350ms gap) even when an NCBI API key speeds up the shared
//          E-utilities queue to ~120ms — PubTator3's official cap is 3 req/s
//          regardless of any NCBI key.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/pubmed-core.js', import.meta.url)), 'utf8')
const registerPubmedTools = new Function(source + '\n; return registerPubmedTools')()
const S = (id) => ({ agent: { id }, signal: AbortSignal.timeout(10000) })
const conceptEdges = (g) => g.session.edges.filter((e) => e.kind === 'relation' && String(e.source).startsWith('concept:') && String(e.target).startsWith('concept:'))

// ------------------------------------------------- scenario A: BUG-2 (late edges)
// One article with 3 concepts (JAK1, JAK2, a chemical), all carrying accessions
// so the default relations probe fires. The mock relations list for @GENE_JAK1:
//   pos 0..17  — 18 off-article filler targets (never become edges)
//   pos 18     — an off-article target the old code kept past its raw cap
//   pos 19     — in-article chemical edge (survived even the old slice(0,20))
//   pos 20     — in-article JAK1→JAK2 edge (DROPPED by the old slice(0,20),
//                must survive after the fix: filter first, cap after)
const PMC = {
  PubTator3: [
    {
      id: '11111111', _id: '11111111|None', infons: {},
      passages: [
        {
          infons: { type: 'title' }, offset: 0, text: 'JAK1 and JAK2 inhibition study.',
          annotations: [
            { id: '1', infons: { identifier: '3716', type: 'Gene', database: 'ncbi_gene', accession: '@GENE_JAK1' }, text: 'JAK1', locations: [{ offset: 0, length: 4 }] },
            { id: '2', infons: { identifier: '3717', type: 'Gene', database: 'ncbi_gene', accession: '@GENE_JAK2' }, text: 'JAK2', locations: [{ offset: 12, length: 4 }] },
            { id: '3', infons: { identifier: 'D012345', type: 'Chemical', database: 'MeSH', accession: '@CHEMICAL_D012345' }, text: 'inhibitor', locations: [{ offset: 20, length: 9 }] },
          ],
        },
      ],
    },
  ],
}
const RELS = []
for (let i = 0; i < 18; i++) RELS.push({ type: 'associate', source: '@GENE_JAK1', target: '@GENE_TGF' + i, publications: i + 1 })
RELS.push({ type: 'associate', source: '@GENE_JAK1', target: '@GENE_NOTINARTICLE', publications: 2 }) // pos 18, off-article
RELS.push({ type: 'associate', source: '@GENE_JAK1', target: '@CHEMICAL_D012345', publications: 7 }) // pos 19, in-article
RELS.push({ type: 'interact', source: '@GENE_JAK1', target: '@GENE_JAK2', publications: 99 })        // pos 20, in-article (late)

const tools = {}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools[d.name] = d },
  httpGet: async (url) => {
    const u = String(url)
    if (u.includes('/relations')) return { status: 200, body: JSON.stringify(RELS) }
    return { status: 200, body: JSON.stringify(PMC) }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})

await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('pd'))
await tools.pubmed_graph_add.execute({ articles: [{ pmid: '11111111', title: 'JAK study', abstractText: 'JAK1 and JAK2 inhibition.' }] }, S('pd'))
const g = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('pd'))
const relEdges = conceptEdges(g)
console.log('scenario A — concept relation edges:', relEdges.length)
for (const e of relEdges) console.log('  ' + e.source + ' --[' + e.label + '(' + e.weight + ')]--> ' + e.target)

const checks = [
  ['late in-article JAK1→JAK2 edge survives (BUG-2 fixed)', relEdges.some((e) => e.target === 'concept:Gene:3717' && e.label === 'interact' && e.weight === 99)],
  ['late in-article JAK1→chemical edge survives', relEdges.some((e) => e.target === 'concept:Chemical:D012345' && e.weight === 7)],
  ['off-article relations stay filtered out (all of them)', relEdges.length === 2],
  ['no relation to any off-article concept', !relEdges.some((e) => e.target === 'concept:Gene:NOTINARTICLE' || /TGF/.test(e.target))],
]

// ------------------------------------------------- scenario B: cap after filtering
// 21 IN-article relations from JAK1 (targets X0..X20 are all annotated in the
// same article): filter keeps 21, the per-concept cap then cuts to 20 — the
// 21st relation (publications=121) must be dropped, the 20th kept.
const PMC_B = {
  PubTator3: [
    {
      id: '22222222', _id: '22222222|None', infons: {},
      passages: [
        {
          infons: { type: 'title' }, offset: 0, text: 'JAK1 broad interaction study.',
          annotations: [
            { id: '0', infons: { identifier: '3716', type: 'Gene', database: 'ncbi_gene', accession: '@GENE_JAK1' }, text: 'JAK1', locations: [{ offset: 0, length: 4 }] },
            ...Array.from({ length: 21 }, (_, i) => ({
              id: String(i + 1),
              infons: { identifier: String(100 + i), type: 'Gene', database: 'ncbi_gene', accession: '@GENE_X' + i },
              text: 'X' + i, locations: [{ offset: 10 + i, length: 2 }],
            })),
          ],
        },
      ],
    },
  ],
}
const RELS_B = Array.from({ length: 21 }, (_, i) => ({ type: 'associate', source: '@GENE_JAK1', target: '@GENE_X' + i, publications: 101 + i }))

const toolsB = {}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { toolsB[d.name] = d },
  httpGet: async (url) => {
    const u = String(url)
    if (u.includes('/relations')) return { status: 200, body: JSON.stringify(RELS_B) }
    return { status: 200, body: JSON.stringify(PMC_B) }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
await toolsB.pubmed_graph_reset.execute({ scope: 'session' }, S('pd'))
await toolsB.pubmed_graph_add.execute({ articles: [{ pmid: '22222222', title: 'JAK1 broad study', abstractText: 'JAK1 interacts broadly.' }] }, S('pd'))
const gB = await toolsB.pubmed_graph_get.execute({ scope: 'session' }, S('pd'))
const relEdgesB = conceptEdges(gB)
console.log('scenario B — concept relation edges:', relEdgesB.length)

checks.push(
  ['cap still limits a concept to 20 in-article edges', relEdgesB.length === 20],
  ['21st in-article relation (publications=121) is the one dropped', !relEdgesB.some((e) => e.target === 'concept:Gene:120')],
  ['20th in-article relation (publications=120) is kept', relEdgesB.some((e) => e.target === 'concept:Gene:119')],
)
for (const [name, ok] of checks) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks.some(([, ok]) => !ok)) { console.log('PUBTATOR DEFAULT FAIL'); process.exit(1) }

// ------------------------------------------------- part 2: dedicated pubtator queue
// Same default extractors but with an NCBI API key configured: the E-utilities
// queue now runs at a ~120ms gap, while every pubtator3-api call must still be
// paced at ~350ms. A mock sleep records the requested waits (resolves
// immediately, so consecutive call gaps equal the queue gap itself).
const tools2 = {}
const sleeps2 = []
let calls = 0
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools2[d.name] = d },
  apiKey: 'test-api-key',
  httpGet: async () => { calls++; return { status: 200, body: JSON.stringify([{ _id: '@GENE_CD79A', biotype: 'gene', db_id: '973', db: 'ncbi_gene', name: 'CD79A', match: '' }]) } },
  sleep: (ms) => { sleeps2.push(ms); return Promise.resolve() },
})
for (let i = 0; i < 3; i++) await tools2.pubmed_pubtator_entity_id.execute({ query: 'cd79a' }, S('pd'))
const gaps = sleeps2.filter((ms) => ms > 100)
// With an instantly-resolving mock sleep the queue schedules by slot, so the
// requested waits accumulate (350, 700, …) while the STEP between consecutive
// waits stays at PUBTATOR_GAP_MS. With real sleeps each wait would be ~350ms.
// Either way every wait is far above the ~120ms NCBI-key gap, which is the
// property under test.
const stepsOk = gaps.every((ms, i) => i === 0 || (ms - gaps[i - 1]) > 300 && (ms - gaps[i - 1]) < 500)
console.log('pubtator calls:', calls, '| recorded sleeps:', JSON.stringify(sleeps2))
const checks2 = [
  ['3 sequential pubtator calls hit the API 3x', calls === 3],
  ['at least 2 paced gaps between them', gaps.length >= 2],
  ['first gap is ~350ms, NOT the ~120ms NCBI-key gap', gaps[0] > 300 && gaps[0] < 500],
  ['every wait far above the ~120ms NCBI-key gap', gaps.every((ms) => ms > 300)],
  ['consecutive waits step by ~350ms (slot pacing)', stepsOk],
]
for (const [name, ok] of checks2) console.log((ok ? 'PASS' : 'FAIL') + '  ' + name)
if (checks2.some(([, ok]) => !ok)) { console.log('PUBTATOR QUEUE FAIL'); process.exit(1) }

console.log('PUBTATOR DEFAULT TEST OK')
