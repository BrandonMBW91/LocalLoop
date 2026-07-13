// SSRF-safe fetch for USER-SUBMITTED feed URLs (event_sources + truck_calendars).
// These pulls run with the service role, so a feed URL must never reach an internal
// address. Guard, in order:
//   1) Reject non-http(s) schemes and known-internal hostnames.
//   2) Resolve ALL A/AAAA records and reject if ANY is private/loopback/link-local/
//      metadata (defeats a dual-record answer that mixes a public and a private IP).
//   3) Follow redirects MANUALLY, re-validating every hop, so a public URL can't 302
//      us onto localhost / cloud metadata / a private range.
// Residual (documented, accepted): a determined attacker who controls authoritative
// DNS for a submitted domain could rebind between our resolve and the socket's own
// resolve (classic check-then-connect TOCTOU). Impact here is low: the response must
// be valid iCal to be stored (so metadata/JSON endpoints yield nothing), the runner
// holds no cloud IAM creds reachable via SSRF, and a feed must first be admin-approved.
// A socket-level DNS pin (custom agent lookup) would close it but needs a hard undici
// dependency; revisit if the threat model changes.
import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    return p[0] === 0 || p[0] === 127 || p[0] === 10
      || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168) || p[0] >= 224;
  }
  const s = ip.toLowerCase();
  return s === '::1' || s === '::' || s.startsWith('fe80:') || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('::ffff:');
}

export async function assertPublicUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new Error('bad url'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`blocked scheme ${url.protocol}`);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) throw new Error('blocked host');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('private ip'); return; }
  const addrs = await dnsLookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('private ip');
}

export async function safeFetch(u, headers, { maxHops = 8 } = {}) {
  let current = u;
  for (let hop = 0; hop < maxHops; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { headers, redirect: 'manual' });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) { current = new URL(loc, current).toString(); continue; }
    return res;
  }
  throw new Error('too many redirects');
}
