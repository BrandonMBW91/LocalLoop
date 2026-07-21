// Shared content-safety rules for anything that PUBLISHES an event title to people.
//
// Extracted 2026-07-21 so the weekly digest email and the Facebook draft routine
// cannot drift apart. Before this, fb-daily-plan.mjs carried its own copy under a
// comment reading "copied from fb-routine.mjs; keep in sync" — an instruction to a
// human to do by hand the one thing a module does for free. Two copies of a safety
// rule means the day someone widens one, the other quietly keeps publishing what the
// widening was meant to stop.
//
// WHY THIS GATE EXISTS AT ALL. Feed events are ingested and auto-approved, and only
// the TITLE is screened at ingest (aggregate.mjs). Descriptions are not screened at
// all, and image_url/ticket_url are user-writable and skip moderation. So anything
// that renders an event to a human screens again, here, at publish time — and renders
// only fields that have been through a gate.
//
// Scope note: these are PUBLISH-time rules, deliberately stricter than ingest. An
// adults-only bar crawl is a real event that belongs in the app for someone who goes
// looking; it does not belong pushed into a stranger's inbox on a Friday morning
// beside a library storytime.

// Positively interesting things — the stuff people actually want a digest for.
export const MARQUEE = /\b(festival|fest|fair|concert|live music|music|band|farmers?|market|cruise|car show|craft|vendor|parade|carnival|fireworks|tournament|expo|celebration|rodeo|brewery|winery|tasting|comedy|theat(er|re)|movie|food truck|art walk|block party|5k|derby)\b/i;

// The subset of MARQUEE that is a genuine draw — the things worth leading a post or
// an email with. A craft club and a county fair both match MARQUEE; only one of them
// gets someone off the sofa.
export const BIGDRAW = /\b(festival|fest|fair|fireworks|parade|carnival|concert|live music|rodeo|expo|derby|car show|cruise|farmers?|market|craft show|art walk|block party|food truck|5k|tournament)\b/i;

// Real events, but recurring civic/program filler. Not wrong, just not a weekend plan;
// a digest full of these reads as noise and trains people to unsubscribe.
export const FILLER = /\b(playgroup|play ?date|pack and play|tot time|toddler|storytime|story time|open house|workshop|webinar|seminar|class(es)?|meeting|worship|service|mass|bible|support group|blood drive|bingo|office hours|orientation|info session)\b/i;

export const isShouty = (t) => {
  const L = (t.match(/[a-z]/gi) || []).length;
  const U = (t.match(/[A-Z]/g) || []).length;
  return L > 8 && U / L > 0.7;
};

export const ADULT = /\b(bar crawl|pub ?crawl|ladies.?night|ladies'? night|white party|foam party|glow party|21\+|18\+|21 ?and ?(up|over)|casino|poker|slots?|gambl\w*|vape|vaping|hookah|cannabis|marijuana|weed|dispensar\w*|kratom|burlesque|drag (?:brunch|bingo|show)|strip(?:per|tease)?|lingerie|wet ?t.?shirt|beer ?olympics|booze|boozy|wine ?crawl|happy ?hour|after.?dark|adults?.?only|singles? (?:night|mixer)|speed dating|gentlemen'?s club|nightclub|rave)\b/i;
export const PROFANITY = /\b(f+u+c+k+\w*|sh[i1]t+\w*|b[i1]tch\w*|bastard|c+u+n+t+|d[i1]ck(?:head|wad)?|a+s+s+h+o+l+e+|jack ?ass|dumb ?ass|c[o0]ck(?:sucker)?|wh[o0]re|slut|f+a+g+\w*|n[i1]gg\w*|tw+a+t|goddamn\w*|g[o0]d ?damn|bull ?sh[i1]t)\b/i;
// Self-censored profanity: "f**k", "sh*t". People mask it precisely because they know
// it is not safe to print.
export const MASKED = /[a-z][*#@$]{2,}[a-z]?/i;
const ENTITY = /&#?\w{1,8};/i;

// Not offensive — broken. Half-parsed feed rows, mojibake, placeholder titles.
export const isGarbage = (t) => {
  const s = (t || '').replace(/…$/, '').trim();
  if (s.length < 6) return true;
  if (ENTITY.test(s)) return true;
  if (/https?:\/\/|www\.|<\/?[a-z]|\{\{|\}\}|Ã.|â€|Â./.test(s)) return true;
  if ((s.match(/[a-z]/gi) || []).length / s.length < 0.5) return true;
  if (/^(test|untitled|tbd|tba|n\/?a|event|new event|sample)\b/i.test(s)) return true;
  if (/(.)\1{4,}/.test(s)) return true;
  return false;
};

export const EVENING_TYPE = /\b(comedy|concert|live music|band|party|festival|fest|nightlife|dance|dj|karaoke|trivia|open mic|fireworks|celebration|carnival)\b/i;
export const isImplausibleTime = (title, h24) => EVENING_TYPE.test(title) && h24 >= 1 && h24 < 11;

export const isUnsafe = (t) => ADULT.test(t) || PROFANITY.test(t) || MASKED.test(t) || isGarbage(t);

// Never an em or en dash in outward copy. They are an AI tell and the owner asks for
// plain punctuation in anything he sends.
export const scrubDashes = (s) => (s || '').replace(/\s*[–—]\s*/g, ' - ');
