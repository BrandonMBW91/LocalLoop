// Mine the public-records mobile food vendor rosters (saved in outreach/rosters/)
// into queue-ready food-truck leads. Reads the two spreadsheets (Richland +
// Summit) and the scraped Hudson city list, maps each vendor's base town to the
// nearest SERVED Local Loop town, splits prepared-food/coffee trucks (Tier A,
// auto-queued) from frozen-dessert / lemonade / farm-market / catering-only /
// nonprofit vendors (Tier B, held for opt-in), dedupes by email against the
// live corpus, and writes outreach/foodtrucks-rosters.json (Tier A).
//
//   node mine-rosters.mjs            # write foodtrucks-rosters.json + print report
//   node mine-rosters.mjs --tierB    # write foodtrucks-rosters-tierB.json instead
import xlsx from 'xlsx';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(dirname(HERE), 'outreach');
const ROSTERS = join(OUT, 'rosters');
const WANT_TIERB = process.argv.includes('--tierB');

const weights = JSON.parse(readFileSync(join(OUT, 'town-weights.json'), 'utf8')).weights || {};
const SERVED = new Set(Object.keys(weights));

// Base town -> nearest served town. Only needed for towns NOT already served.
const TOWN_MAP = {
  // Richland / Ashland county -> Mansfield hub (Ontario/Ashland/Galion served)
  Butler: 'Mansfield', Shelby: 'Mansfield', Bellville: 'Mansfield', Lexington: 'Mansfield',
  Lucas: 'Mansfield', Shiloh: 'Mansfield', Crestline: 'Galion', Ontario: 'Ontario',
  // Summit / Medina county
  Norton: 'Barberton', Copley: 'Akron', Fairlawn: 'Akron', Peninsula: 'Cuyahoga Falls',
  Twinsburg: 'Hudson', Uniontown: 'Hartville', Richfield: 'Akron', Northfield: 'Hudson',
  'Munroe Falls': 'Stow', Seville: 'Medina', Clinton: 'Barberton', Macedonia: 'Hudson',
  Bath: 'Akron', Tallmadge: 'Tallmadge', Mogadore: 'Akron', Reminderville: 'Hudson',
};
const mapTown = (raw) => {
  const t = (raw || '').trim();
  if (!t) return null;
  if (SERVED.has(t)) return t;
  if (TOWN_MAP[t]) return TOWN_MAP[t];
  return null; // out of market / unknown -> drop
};

// Tier B = mobile vendors that don't fit the "where's your truck today" pitch:
// frozen desserts, standalone lemonade/snow-cone fair concessions, ice cream
// routes, farm/market stands, catering-only, and nonprofit/club stands.
const TIERB_RE = /lemonade|snow ?cone|shaved ice|kona ice|\bice cream\b|creamery|gelato|snowy station|rolling lemon|soda co-?op|dairy belle|italian ice|popsicle|daisy pops|dreamsicle|icy paw|leeana'?s bananas|perks|sip n sweets|nene'?s sweets|puckers|susie lynne|booze buddies|lanie'?s lemons|\bfarm\b|natural market|perfect market|steading|orchard|\btea co(mpany)?\b|druids garden|catering|lion'?s club|rotary|booster|whitaker|\bconcession/i;
// ...but a name that literally says truck/grill/kitchen/bbq/tacos is a real food
// truck even if it also caters, so those override the Tier B match.
const OVERRIDE_RE = /\b(truck|grill|kitchen|bbq|tacos?|burger|hibachi|gyro|pierogi|wings?|smokehouse|pizza|taqueria)\b/i;

// Corporate chains, stadium/zoo/venue concessions, and government addresses are
// not real owner-operated outreach targets - drop them entirely.
const CORP_RE = /rubberducks|akronzoo|\bcrumbl\b|pjunited|papa john|swensons|chick-?fil|@cityof|\.gov$|@.*\.org$/i;

const cuisineOf = (name) => {
  const n = name.toLowerCase();
  const map = [
    [/taco|birria|agave|catrina|taqueria|pollo|mexican|taconazo/, 'Mexican / tacos'],
    [/bbq|smoke|rib|brisket|smokehouse/, 'BBQ'],
    [/burger|smash|handheld/, 'Burgers'],
    [/hibachi|thai|asian|wok|pho|boba|ramen/, 'Asian / hibachi'],
    [/gyro|greek|mediterr/, 'Greek / Mediterranean'],
    [/pizza|wood fired/, 'Pizza'],
    [/coffee|espresso|brew|barista|first sip/, 'Coffee'],
    [/donut|waffle|sweet|dessert|bak(e|ing)/, 'Sweets / bakery'],
    [/soul|wing|chicken|fry|fried/, 'Soul food / comfort'],
    [/pierogi|polish/, 'Pierogi'],
    [/coney|dog|sausage|hot ?dawg/, 'Hot dogs / sausage'],
  ];
  for (const [re, c] of map) if (re.test(n)) return c;
  return 'food';
};

// --- pick a usable email from one or more candidate strings ---
const pickEmail = (...cands) => {
  for (const c of cands) {
    if (!c) continue;
    // Some source cells split the local part with a stray space
    // ("Cops 4kidswithautism@yahoo.com"); rejoin word+space+word before an @.
    const s = String(c).replace(/([A-Za-z0-9._%+-])\s+([A-Za-z0-9._%+-]*@)/g, '$1$2');
    const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    if (m) return m[0].toLowerCase();
  }
  return '';
};

const rows = []; // {name, baseTown, email, phone, source}

// ---- Richland Public Health (Mansfield area) ----
{
  const wb = xlsx.readFile(join(ROSTERS, 'richlandhealth.org-Mobile list 7-9-2026.xlsx'));
  const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  for (const r of data) {
    const name = String(r['Permit Name'] || '').trim();
    if (!name) continue;
    // "390 Marion Ave.  Mansfield, OH 44903" -> the single word just before ", OH"
    const addr = String(r['Address'] || '') + ' | ' + String(r['Owner Address'] || '');
    const town = (addr.match(/([A-Za-z][A-Za-z.'-]*)\s*,\s*OH\b/) || [])[1]?.trim() || '';
    rows.push({
      name, baseTown: town.replace(/\s+/g, ' ').trim(),
      email: pickEmail(r['Owner Email'], r['Facility Email']),
      phone: String(r['Owner Phone'] || r['Establishment Phone'] || '').trim(),
      source: 'Richland Public Health roster (records request, Jul 2026)',
    });
  }
}
// ---- Summit County Public Health ----
{
  const wb = xlsx.readFile(join(ROSTERS, 'schd.org-Mobile Licenses 7-9-26.xlsx'));
  const data = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  for (const r of data) {
    const name = String(r['Permit Name'] || '').trim();
    if (!name) continue;
    if (String(r['Status'] || '').toLowerCase().includes('closed')) continue;
    rows.push({
      name, baseTown: String(r['City'] || '').trim(),
      email: pickEmail(r['Owner Email']),
      phone: String(r['Owner Phones'] || '').trim(),
      source: 'Summit County Public Health roster (records request, Jul 2026)',
    });
  }
}
// ---- City of Hudson licensed food-truck list (scraped from city site) ----
const HUDSON = [
  ['CC Foods', '', '26-334'], ['Chick-fil-a', '02197@chick-fil-a.com', '26-297'],
  ['Cleveland Waffle Co', 'clevelandwaffleco@gmail.com', '26-786'],
  ['Coynes Caribbean Coffee', 'Coynescaribbeancoffee@gmail.com', '26-397'],
  ['Daisy Pops', 'amy@daisypops.com', '26-260'], ['Don Patron', '', '26-402'],
  ['Dreamsicle Ice Cream Truck', 'dreamsicletruck@gmail.com', '26-472'],
  ['Event Novelty Truck', 'eventnovelty@gmail.com', '26-8'],
  ['Grind Head Coffee', 'fivegeesellc@gmail.com', '26-304'],
  ["Henry's Creamery", 'justingirves@gmail.com', '26-222'],
  ["John's Gyro King", 'gfakelis@yahoo.com', '26-103'],
  ["Judy and Adam's Concessions", 'A25j28@att.net', '26-345'],
  ['Kona Ice', 'sbarta@kona-ice.com', '26-355'],
  ['Madame Boba', 'support@madameboba.com', '26-417'],
  ['Parked Pierogi', 'wepark4pierogies@gmail.com', '26-315'],
  ['Roll Call Burgers', 'rollcallburgers@gmail.com', '26-310'],
  ["Travelin' Tom's Coffee", 'vabell@travelintomscoffee.com', '26-114'],
];
for (const [name, email, permit] of HUDSON) {
  rows.push({ name, baseTown: 'Hudson', email: pickEmail(email), phone: '',
    source: `City of Hudson licensed food-truck list (permit ${permit}, records reply Jul 2026)` });
}

// --- existing corpus for dedupe reporting (assembler also dedupes) ---
const businesses = JSON.parse(readFileSync(join(OUT, 'businesses.json'), 'utf8'));
const listFile = (f) => (existsSync(join(OUT, f)) ? readFileSync(join(OUT, f), 'utf8').split(/\r?\n/) : [])
  .map((l) => l.trim().toLowerCase()).filter(Boolean);
const have = new Set([
  ...businesses.map((b) => (b.email || '').toLowerCase()),
  ...listFile('suppress.txt'), ...listFile('bounced.txt'),
].filter(Boolean));

// --- classify + dedupe ---
const seen = new Set();
const tierA = [], tierB = [], noEmail = [], outOfMarket = [], dupes = [], corp = [];
for (const r of rows) {
  const town = mapTown(r.baseTown);
  if (!r.email) { noEmail.push(r); continue; }
  if (CORP_RE.test(r.name) || CORP_RE.test(r.email)) { corp.push(r); continue; }
  if (!town) { outOfMarket.push(r); continue; }
  if (have.has(r.email) || seen.has(r.email)) { dupes.push(r); continue; }
  seen.add(r.email);
  const isTierB = TIERB_RE.test(r.name) && !OVERRIDE_RE.test(r.name);
  const lead = {
    name: r.name, town, cuisine: cuisineOf(r.name), email: r.email,
    website: '', source_url: r.source, hook: '',
  };
  (isTierB ? tierB : tierA).push(lead);
}

// --- BG cross-reference (PDF has no emails, cannot queue) ---
const bgPdfNames = ['BD LEMONADE KING','BIG DADDY SAUSAGE','BLUE COLLAR','BUCKING BARISTA',"DEET'S BBQ #104","DEET'S BBQ #105",'DETROIT MINI DONUT','FATBOYZ','FIRST SIP COFFEE','HOT DAWG HUT','ICY PAW','JAMAICAN SPICE ON WHEELS','JONNY BURRITOS','KICKBACK COFFEE','KONA ICE','LA CATRINA MEXICAN TACOS',"LEEANA'S BANANAS",'LOADED GASTRO','LOS AGAVES','LOS POLLO LOCO 419',"MANNY'S MUNCHIES",'MBS FOOD SERVICE',"NENE'S SWEETS",'NIGHT OWL DINER','PUCKERS FRESH LEMONADE','ROCK N BOBA','SIP N SWEETS MIDWEST','SNOWY STATION','STREET TACOS #2',"SUSIE LYNNE'S LEMONADE #1","SUSIE LYNNE'S LEMONADE #3","SWORDEN'S SMOKE BBQ",'TAMALE GUY','THE FRONT PORCH PERFECT MARKET','THE LOADED CHICKEN','THE ROLLING LEMON','THE SODA COOP','THE TUCKER TRUCK',"TRAVELIN TOM'S COFFEE",'WAILING ONION','WOK UP STREET HIBACHI','WRAPPIN AND ROLLIN','YUMMY YUMMY N YOUR TUMMY'];
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
let bgExisting = [];
try { bgExisting = (JSON.parse(readFileSync(join(OUT, 'foodtrucks-bg.json'), 'utf8'))[0].leads || []).map((l) => norm(l.name)); } catch {}
const bgNew = bgPdfNames.filter((n) => !bgExisting.some((e) => e.includes(norm(n).slice(0, 8)) || norm(n).includes(e.slice(0, 8))));

// --- write output ---
const outLeads = WANT_TIERB ? tierB : tierA;
const outFile = WANT_TIERB ? 'foodtrucks-rosters-tierB.json' : 'foodtrucks-rosters.json';
writeFileSync(join(OUT, outFile), JSON.stringify([{ region: `Public-records rosters ${WANT_TIERB ? '(Tier B)' : '(Tier A)'} Jul 2026`, leads: outLeads }], null, 1));

// --- report ---
const byTown = (arr) => { const m = {}; for (const l of arr) m[l.town] = (m[l.town] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); };
console.log(`\nWrote ${outFile}: ${outLeads.length} leads\n`);
console.log(`TIER A (prepared-food + coffee trucks, ready to queue): ${tierA.length}`);
console.log('  by town:', byTown(tierA).map(([t, c]) => `${t} ${c}`).join(', '));
console.log(`\nTIER B (frozen/lemonade/farm/catering/nonprofit - held for opt-in): ${tierB.length}`);
console.log('  by town:', byTown(tierB).map(([t, c]) => `${t} ${c}`).join(', '));
console.log(`\nSkipped: ${noEmail.length} no email, ${outOfMarket.length} out-of-market town, ${dupes.length} already in corpus/suppressed, ${corp.length} corporate/venue`);
console.log('  corporate/venue dropped:', corp.map((r) => r.name).join(', ') || '(none)');
console.log('  out-of-market towns:', [...new Set(outOfMarket.map((r) => r.baseTown))].filter(Boolean).join(', ') || '(none)');
console.log('  dupes:', dupes.map((r) => r.name + ' <' + r.email + '>').join('; ') || '(none)');
console.log(`\nBG official roster: ${bgPdfNames.length} vendors, NO emails in PDF (cannot queue). Not already in foodtrucks-bg.json: ${bgNew.length}`);
console.log('  ' + bgNew.join(', '));
if (process.argv.includes('--list')) {
  console.log('\n--- TIER A leads ---');
  for (const l of tierA) console.log(`${l.town.padEnd(16)} ${l.name}  <${l.email}>  [${l.cuisine}]`);
  console.log('\n--- TIER B leads ---');
  for (const l of tierB) console.log(`${l.town.padEnd(16)} ${l.name}  <${l.email}>`);
}
