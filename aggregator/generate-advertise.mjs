// Generates site/advertise.html with LIVE, per-town pricing — the web mirror of
// the app's advertise screen. Bakes each town's real monthly-active-user count,
// maps it to a tier via the shared pricing.js, and picks the matching Stripe link.
// A town selector lets a visitor see their own town's rate. Refreshed by CI daily.
//
//   node generate-advertise.mjs   (from aggregator/)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadDotEnv } from './env.mjs';
import { CITIES, REGION_ORDER } from '../src/data/cities.js';
import { rateForUsers } from '../src/data/pricing.js';

loadDotEnv();
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'site', 'advertise.html');

// Stripe payment links — KEEP IN SYNC with app/promote.js.
const REGION_LINK = 'https://buy.stripe.com/cNi8wQ5P94cqf8WaIL4Vy01'; // $79/mo flat
const LINKS = {
  Founding: { town: 'https://buy.stripe.com/aFa9AU0uPaAO2ma18b4Vy00', feat30: 'https://buy.stripe.com/00w4gA6TddN0bWK9EH4Vy02' },
  Local: { town: 'https://buy.stripe.com/9B65kE1yT24i6CqbMP4Vy03', feat30: 'https://buy.stripe.com/7sY28s91l8sG1i6bMP4Vy04' },
};
const MAIL = 'mailto:localloop@localloop.io?subject=Advertising%20on%20Local%20Loop';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

// Per-town monthly active users = distinct devices seen in last 30 days.
const mau = {};
{
  const seen = new Set();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from('device_activity').select('device_id,city_id,last_seen').gte('last_seen', monthAgo).range(from, from + 999);
    (data || []).forEach((d) => { const k = `${d.city_id}|${d.device_id}`; if (!seen.has(k)) { seen.add(k); mau[d.city_id] = (mau[d.city_id] || 0) + 1; } });
    if (!data || data.length < 1000) break;
  }
}

// Per-town pricing payload for the client.
const DATA = {};
for (const c of CITIES) {
  const users = mau[c.id] || 0;
  const r = rateForUsers(users);
  const l = LINKS[r.name] || null;
  DATA[c.id] = { name: c.name, users, tier: r.name, sponsor: r.sponsor, featured30: r.featured30, townLink: l ? l.town : null, feat30Link: l ? l.feat30 : null };
}
const DEFAULT = DATA.findlay ? 'findlay' : CITIES[0].id;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const options = REGION_ORDER.map((region) => {
  const opts = CITIES.filter((c) => c.region === region).map((c) => `<option value="${c.id}"${c.id === DEFAULT ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
  return `<optgroup label="${esc(region)}">${opts}</optgroup>`;
}).join('');
const TIERS = [['Founding', 'Starting out', '$19/mo', '$25'], ['Local', '50 or more', '$29/mo', '$35'], ['Established', '250 or more', '$49/mo', '$49'], ['Premier', '1,000 or more', '$79/mo', '$79']];

const STYLE = `:root{--green:#1F6F54;--green-d:#15503D;--orange:#D9772B;--bg:#FBFAF7;--surface:#fff;--ink:#1A1A1A;--muted:#5B5B5B;--line:#E2DED7;}*{box-sizing:border-box;}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;}.wrap{max-width:1000px;margin:0 auto;padding:0 20px;}header{display:flex;align-items:center;justify-content:space-between;padding:18px 0;}.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:20px;text-decoration:none;color:var(--ink);}nav a{color:var(--green);text-decoration:none;font-weight:600;margin-left:18px;}.hero{text-align:center;padding:40px 0 10px;}.hero h1{font-size:38px;line-height:1.15;margin:0 0 12px;}.hero p{font-size:19px;color:var(--muted);max-width:620px;margin:0 auto;}.picker{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:18px auto 0;max-width:560px;}.picker label{font-weight:600;}.picker select{font-size:16px;padding:9px 12px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);}#rateNote{font-weight:600;color:var(--green-d);}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin:24px 0;}.price{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:26px;display:flex;flex-direction:column;}.price.feat{border:2px solid var(--orange);}.tag{font-size:13px;font-weight:700;letter-spacing:.5px;color:var(--orange);text-transform:uppercase;}.price h3{margin:6px 0 2px;font-size:22px;}.amt{font-size:34px;font-weight:800;color:var(--green);margin:6px 0;}.amt span{font-size:16px;font-weight:600;color:var(--muted);}.amt small{display:block;font-size:14px;font-weight:600;color:var(--muted);margin-top:2px;}.price ul{list-style:none;padding:0;margin:10px 0 20px;color:var(--muted);font-size:15px;}.price li{padding:5px 0 5px 24px;position:relative;}.price li:before{content:"✓";position:absolute;left:0;color:var(--green);font-weight:700;}.buy{margin-top:auto;display:block;text-align:center;background:var(--green);color:#fff;text-decoration:none;font-weight:700;padding:13px;border-radius:999px;}.buy.alt{background:var(--orange);}.steps,.tiers{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:28px;margin:36px 0;}.steps h2,.tiers h2{margin:0 0 16px;}.steps ol{margin:0;padding-left:22px;color:var(--muted);}.steps li{margin-bottom:8px;}.tiers p.lede{margin:0 0 18px;color:var(--muted);}.tier-scroll{overflow-x:auto;}table.tiers-table{border-collapse:collapse;width:100%;min-width:520px;font-size:15px;}table.tiers-table th,table.tiers-table td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--line);}table.tiers-table th{color:var(--muted);font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:.4px;}table.tiers-table td:first-child{font-weight:700;}table.tiers-table tr.now td{background:#E7F2EE;}.tier-badge{display:inline-block;font-size:11px;font-weight:700;color:var(--green);background:#fff;border:1px solid var(--green);border-radius:999px;padding:1px 8px;margin-left:8px;vertical-align:middle;}.foot-note{color:var(--muted);font-size:14px;text-align:center;margin:24px 0;}footer{border-top:1px solid var(--line);padding:28px 0;color:var(--muted);font-size:14px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;}footer a{color:var(--green);text-decoration:none;}@media(max-width:560px){.hero h1{font-size:30px;}}`;

const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Advertise on Local Loop: Reach Your Town</title>
<meta name="description" content="Put your business in front of locals across ${CITIES.length} Ohio towns. Your rate is set by real usage in your town — pick your town to see today's price."/>
<link rel="canonical" href="https://localloop.io/advertise.html"/>
<meta property="og:title" content="Advertise on Local Loop"/><meta property="og:description" content="Featured listings and town sponsorships across ${CITIES.length} Ohio towns. Pick your town for today's rate."/>
<meta property="og:url" content="https://localloop.io/advertise.html"/><meta property="og:type" content="website"/>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231F6F54'/%3E%3C/svg%3E"/>
<style>${STYLE}</style></head><body><div class="wrap">
<header><a class="brand" href="/"><svg width="32" height="32" viewBox="0 0 1024 1024" aria-hidden="true"><rect width="1024" height="1024" rx="232" fill="#1F6F54"/><rect x="432" y="392" width="160" height="150" rx="18" fill="#D9772B"/></svg> Local Loop</a><nav><a href="/">Home</a></nav></header>

<section class="hero">
  <h1>Reach your neighbors</h1>
  <p>Put your business in front of locals who are looking for something to do. Your rate is set by how many people use Local Loop in your town, so it starts low and only grows as your town does. Sign up now and lock today's rate in for a full year.</p>
  <div class="picker"><label for="townPick">Your town:</label><select id="townPick" aria-label="Choose your town">${options}</select><span id="rateNote"></span></div>
</section>

<div class="grid">
  <div class="price feat">
    <span class="tag">★ Most popular</span><h3>Town Sponsor</h3>
    <div class="amt" id="sponsorAmt"></div>
    <ul><li>Your ad shown between listings in your town</li><li>Headline and a link to your site or phone</li><li>Ask us any time for your views and taps</li><li>Cancel anytime</li></ul>
    <a class="buy" id="sponsorBuy" href="#">Become a sponsor</a>
  </div>
  <div class="price">
    <span class="tag">One-time</span><h3>Featured Listing</h3>
    <div class="amt" id="featAmt"></div>
    <ul><li>Float an event, sale, or food truck to the top</li><li>★ Featured badge and highlight</li><li>Great for a one-time event or grand opening</li><li>Shorter 7-day option available too</li></ul>
    <a class="buy alt" id="featBuy" href="#">Feature my listing</a>
  </div>
  <div class="price">
    <span class="tag">Best value</span><h3>All of Our Region</h3>
    <div class="amt">$79<span>/month</span><small>One flat rate for every town</small></div>
    <ul><li>Your ad runs in every town we cover</li><li>Maximum local reach across ${CITIES.length} towns</li><li>One price, no matter how each town grows</li><li>Cancel anytime</li></ul>
    <a class="buy" href="${REGION_LINK}">Sponsor the region</a>
  </div>
  <div class="price">
    <span class="tag">Custom</span><h3>Something Different</h3>
    <div class="amt">Let's talk</div>
    <ul><li>Multiple towns, longer runs, or bigger placements</li><li>Event and season sponsorships</li><li>Nonprofits and community organizations</li><li>We'll build a plan around your goals</li></ul>
    <a class="buy alt" href="${MAIL}">Email us to discuss</a>
  </div>
</div>

<div class="tiers">
  <h2>How the price works</h2>
  <p class="lede">You always pay your own town's current rate, set by how many people use Local Loop there each month. It starts low and only steps up as more neighbors join. Sign up now and your rate is locked in for a full year, even as the town grows.</p>
  <div class="tier-scroll"><table class="tiers-table"><thead><tr><th>Tier</th><th>Town size (people using the app)</th><th>Town Sponsor</th><th>Featured 30 days</th></tr></thead><tbody>
  ${TIERS.map(([n, size, sp, f]) => `<tr data-tier="${n}"><td>${n}<span class="tier-badge" style="display:none">Your town</span></td><td>${size}</td><td>${sp}</td><td>${f}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="foot-note" style="text-align:left;margin:16px 0 0;">The 7-day Featured option follows the same tiers ($9, $12, $19, then $29), by email. The All-Region plan is a flat $79/mo across every town.</p>
</div>

<div class="steps"><h2>How it works</h2><ol>
  <li><strong>Pick your town</strong> above to see today's rate, then check out securely with Stripe (card or Apple/Google Pay). Prefer to talk first? Email us.</li>
  <li><strong>Tell us about your ad</strong>: your business name, headline, link, and town.</li>
  <li><strong>You go live</strong> in the app, with simple monthly billing.</li>
  <li><strong>Ask us for your numbers</strong> any time: views and taps, so you see the reach you're getting.</li>
</ol></div>

<p class="foot-note">Questions, or want to feature an event for a single weekend? Email <a href="mailto:localloop@localloop.io">localloop@localloop.io</a> and we'll set you up.</p>
<footer><div>© 2026 Local Loop</div><div><a href="/">Home</a> · <a href="/privacy.html">Privacy</a> · <a href="mailto:localloop@localloop.io">Contact</a></div></footer>
</div>
<script>
var DATA=${JSON.stringify(DATA)},MAIL=${JSON.stringify(MAIL)};
var sel=document.getElementById('townPick');
function up(){
  var t=DATA[sel.value]; if(!t)return;
  document.getElementById('sponsorAmt').innerHTML='$'+t.sponsor+'<span>/month</span><small>'+t.tier+' rate in '+t.name+'</small>';
  document.getElementById('featAmt').innerHTML='$'+t.featured30+'<span>/30 days</span><small>'+t.tier+' rate in '+t.name+'</small>';
  var sb=document.getElementById('sponsorBuy'), fb=document.getElementById('featBuy');
  if(t.townLink){sb.href=t.townLink;sb.textContent='Become a sponsor';}else{sb.href=MAIL;sb.textContent='Email us to sponsor';}
  if(t.feat30Link){fb.href=t.feat30Link;fb.textContent='Feature my listing';}else{fb.href=MAIL;fb.textContent='Email us to feature';}
  document.getElementById('rateNote').textContent=t.name+' is at the '+t.tier+' rate ('+t.users+' active this month).';
  document.querySelectorAll('table.tiers-table tbody tr').forEach(function(r){
    var on=r.getAttribute('data-tier')===t.tier; r.classList.toggle('now',on);
    var b=r.querySelector('.tier-badge'); if(b)b.style.display=on?'':'none';
  });
}
sel.addEventListener('change',up); up();
</script>
</body></html>`;

writeFileSync(OUT, html);
const tiers = {};
Object.values(DATA).forEach((d) => (tiers[d.tier] = (tiers[d.tier] || 0) + 1));
console.log(`advertise.html written · ${CITIES.length} towns · tiers:`, JSON.stringify(tiers));
console.log('non-Founding towns:', Object.entries(DATA).filter(([, d]) => d.tier !== 'Founding').map(([id, d]) => `${d.name}=${d.tier}`).join(', ') || '(none)');
