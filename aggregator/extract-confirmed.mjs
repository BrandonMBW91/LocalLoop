// Reconstruct the confirmed-feed list from a coverage-workflow transcript dir,
// independent of the workflow's return value. Joins each town's RESEARCH candidates
// with its VERIFY approvals (ok=true urls) so only independently-verified feeds pass.
//   node extract-confirmed.mjs <workflow-transcript-dir> > confirmed.json
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node extract-confirmed.mjs <dir>'); process.exit(1); }

const { CITIES } = await import('../src/data/cities.js');
const nameToId = new Map(CITIES.map((c) => [c.name.toLowerCase(), c.id]));

// agentId -> result payload, from the journal.
const journal = readFileSync(join(dir, 'journal.jsonl'), 'utf8').split('\n').filter(Boolean);
const byAgent = new Map();
for (const line of journal) {
  let o; try { o = JSON.parse(line); } catch { continue; }
  if (o.type === 'result' && o.agentId) byAgent.set(o.agentId, o.result);
}

// For each agent file, find its town + role from the embedded prompt.
const townMarker = /TOWN:\s*(.+?),\s*Ohio/;
const verifyMarker = /verify candidate event feeds for\s*(.+?),\s*Ohio/;
const perTown = {}; // id -> { research: [candidates], ok: Set(urls) }

for (const fn of readdirSync(dir)) {
  const m = /^agent-(\w+)\.jsonl$/.exec(fn);
  if (!m) continue;
  const agentId = m[1];
  const result = byAgent.get(agentId);
  if (!result) continue; // agent never returned a result
  const txt = readFileSync(join(dir, fn), 'utf8');
  const isVerify = Array.isArray(result.results);
  const isResearch = Array.isArray(result.candidates);
  const nameM = isVerify ? verifyMarker.exec(txt) : townMarker.exec(txt);
  if (!nameM) continue;
  const id = nameToId.get(nameM[1].trim().toLowerCase());
  if (!id) { console.error(`! no city id for "${nameM[1].trim()}"`); continue; }
  perTown[id] = perTown[id] || { research: [], ok: new Set() };
  if (isResearch) perTown[id].research.push(...result.candidates);
  if (isVerify) for (const r of result.results) if (r.ok) perTown[id].ok.add(r.url);
}

const confirmed = [];
for (const [id, d] of Object.entries(perTown)) {
  for (const c of d.research) {
    if (d.ok.has(c.url)) confirmed.push({ city_id: id, name: c.name, type: c.type, url: c.url, category: c.category, futureEvents: c.futureEvents, evidence: c.evidence });
  }
}

// Report to stderr; JSON to stdout.
const towns = new Set(confirmed.map((c) => c.city_id));
console.error(`towns with research: ${Object.keys(perTown).length}, confirmed feeds: ${confirmed.length} across ${towns.size} towns`);
process.stdout.write(JSON.stringify(confirmed, null, 0));
