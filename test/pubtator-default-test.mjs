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
            // P3.5: un-normalizable mention with a placeholder identifier —
            // must NOT become a concept node.
            { id: '4', infons: { identifier: '-', type: 'Disease', database: 'MeSH' }, text: 'unknown', locations: [{ offset: 30, length: 7 }] },
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
RELS.push({ type: 'interact', source: '@GENE_JAK1', target: '@GENE_JAK1', publications: 5 })         // pos 21, SELF-LOOP (dimer) — P3.5 must drop it

// Evidence fixture for P1a: the search endpoint answers relation-evidence
// queries with these two PMIDs.
const SEARCH_EV = { results: [{ pmid: 99900001, title: 'Evidence A' }, { pmid: 99900002, title: 'Evidence B' }] }

const tools = {}
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { tools[d.name] = d },
  httpGet: async (url) => {
    const u = String(url)
    if (u.includes('/relations')) return { status: 200, body: JSON.stringify(RELS) }
    // NOTE: the real endpoint is '/search/?text=' (slash before '?')
    if (u.includes('/search/')) return { status: 200, body: JSON.stringify(SEARCH_EV) }
    return { status: 200, body: JSON.stringify(PMC) }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})

await tools.pubmed_graph_reset.execute({ scope: 'session' }, S('pd'))
await tools.pubmed_graph_add.execute({ articles: [{ pmid: '11111111', title: 'JAK study', abstractText: 'JAK1 and JAK2 inhibition.' }] }, S('pd'))
const g = await tools.pubmed_graph_get.execute({ scope: 'session' }, S('pd'))
const relEdges = conceptEdges(g)
console.log('scenario A — concept relation edges:', relEdges.length)
for (const e of relEdges) console.log('  ' + e.source + ' --[' + e.label + '(' + e.weight + ')]--> ' + e.target + (e.detail && e.detail.evidencePmids ? ' ev=' + JSON.stringify(e.detail.evidencePmids) : ''))

const chemEdge = relEdges.find((e) => e.target === 'concept:Chemical:D012345')
const checks = [
  ['late in-article JAK1→JAK2 edge survives (BUG-2 fixed)', relEdges.some((e) => e.target === 'concept:Gene:3717' && e.label === 'interact' && e.weight === 99)],
  ['late in-article JAK1→chemical edge survives', !!chemEdge && chemEdge.weight === 7],
  ['off-article relations stay filtered out (all of them)', relEdges.length === 2],
  ['no relation to any off-article concept', !relEdges.some((e) => e.target === 'concept:Gene:NOTINARTICLE' || /TGF/.test(e.target))],
  ['P3.5 self-loop (dimer) edge dropped', !relEdges.some((e) => e.source === e.target)],
  ['P3.5 placeholder-ID ("-") concept node skipped', !g.session.nodes.some((n) => n.conceptId === '-')],
  ['P1a low-evidence edge carries evidencePmids', !!chemEdge && Array.isArray(chemEdge.detail && chemEdge.detail.evidencePmids) && chemEdge.detail.evidencePmids.join(',') === '99900001,99900002'],
  ['P1a high-evidence edge (99 pubs) skips evidence lookup', !(relEdges.find((e) => e.target === 'concept:Gene:3717') || {}).detail],
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

// ------------------------------------------------- scenario C: P3.4 probe priority
// Article order: Gene G1, Disease D1, Gene G2, Disease D2 (4 concepts). Only
// @DISEASE_D2 has relations (D2 —treat→ D1, both in-article). With the old
// first-3-by-order probe, D2 (position 4) was never queried and the edge was
// lost. Type-prioritized probing (Disease > Chemical > Gene > ...) probes D1,
// D2, G1 — the edge now survives. Evidence is OFF here to also prove the
// PUBTATOR_EDGE_EVIDENCE:false path makes zero search calls.
const PMC_C = {
  PubTator3: [
    {
      id: '33333333', _id: '33333333|None', infons: {},
      passages: [
        {
          infons: { type: 'title' }, offset: 0, text: 'D1 and D2 study.',
          annotations: [
            { id: '1', infons: { identifier: 'G1', type: 'Gene', database: 'ncbi_gene', accession: '@GENE_G1' }, text: 'G1', locations: [{ offset: 0, length: 2 }] },
            { id: '2', infons: { identifier: 'D000001', type: 'Disease', database: 'MeSH', accession: '@DISEASE_D1' }, text: 'D1', locations: [{ offset: 3, length: 2 }] },
            { id: '3', infons: { identifier: 'G2', type: 'Gene', database: 'ncbi_gene', accession: '@GENE_G2' }, text: 'G2', locations: [{ offset: 6, length: 2 }] },
            { id: '4', infons: { identifier: 'D000002', type: 'Disease', database: 'MeSH', accession: '@DISEASE_D2' }, text: 'D2', locations: [{ offset: 9, length: 2 }] },
          ],
        },
      ],
    },
  ],
}
const RELS_C = {
  '@DISEASE_D2': [{ type: 'treat', source: '@DISEASE_D2', target: '@DISEASE_D1', publications: 12 }],
}
const toolsC = {}
const urlsC = []
registerPubmedTools({ get: () => undefined }, {
  defineTool: (o) => o,
  register: (d) => { toolsC[d.name] = d },
  pubtatorEdgeEvidence: false,
  httpGet: async (url) => {
    const u = String(url)
    urlsC.push(u)
    if (u.includes('/relations')) {
      const e1 = decodeURIComponent((u.match(/[?&]e1=([^&]*)/) || [])[1] || '')
      return { status: 200, body: JSON.stringify(RELS_C[e1] || []) }
    }
    return { status: 200, body: JSON.stringify(PMC_C) }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
})
await toolsC.pubmed_graph_reset.execute({ scope: 'session' }, S('pd'))
await toolsC.pubmed_graph_add.execute({ articles: [{ pmid: '33333333', title: 'D study', abstractText: 'D1 and D2.' }] }, S('pd'))
const gC = await toolsC.pubmed_graph_get.execute({ scope: 'session' }, S('pd'))
const relEdgesC = conceptEdges(gC)
console.log('scenario C — concept relation edges:', relEdgesC.length)
for (const e of relEdgesC) console.log('  ' + e.source + ' --[' + e.label + '(' + e.weight + ')]--> ' + e.target)

checks.push(
  ['P3.4 late-position Disease concept still probed (type priority)', relEdgesC.some((e) => e.source === 'concept:Disease:D000002' && e.target === 'concept:Disease:D000001' && e.label === 'treat')],
  ['P3.4 probe width respected (3 concepts queried)', urlsC.filter((u) => u.includes('/relations')).length === 3],
  ['PUBTATOR_EDGE_EVIDENCE:false makes zero search calls', !urlsC.some((u) => u.includes('/search/'))],
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
