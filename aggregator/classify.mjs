// Categorize local events with Claude. Keeps every label inside the app's fixed
// category list (so the filter chips always match), and falls back gracefully to
// 'Community' on any error or unexpected output.

export const CATEGORIES = ['Music', 'Family', 'Food', 'Sports', 'Arts', 'Community', 'Market', 'Education'];

export const EMOJI = {
  Music: '🎶', Family: '👨‍👩‍👧', Food: '🍽️', Sports: '🏅',
  Arts: '🎨', Community: '🤝', Market: '🛍️', Education: '📚',
};

export function emojiFor(category) {
  return EMOJI[category] || '📅';
}

const MODEL = 'claude-haiku-4-5'; // cheap + fast; classification is easy work
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

const SYSTEM = `You label local community events with ONE category each.
Allowed categories (return these strings EXACTLY): ${CATEGORIES.join(', ')}.
Guidance:
- Music: concerts, live bands, DJs, open mic, recitals.
- Family: ONLY events explicitly for children or for parents+kids together — storytime, baby/toddler/preschool programs, kids crafts, school-age (grades K-12) clubs, family movie/game nights. Do NOT use Family just because an event is "all ages" or open to everyone.
- Food: tastings, dinners, food trucks, cooking, farmers-to-table dining.
- Sports: games, races, tournaments, fitness, yoga, recreation, outdoors.
- Arts: art shows, theater, crafts, museums, film, dance, literature, adult craft/art nights, writing groups.
- Market: markets, vendor fairs, craft shows, sales, swap meets, expos.
- Education: classes, lectures, workshops, seminars, academic talks, tech/computer help, adult book clubs and discussion groups, genealogy, financial/health info sessions.
- Community: civic meetings, fundraisers, clubs, volunteering, holidays, blood drives, support groups, anything else.
Pick the single best fit for the LIKELY AUDIENCE. An adult lecture, adult book club, or adult craft night is NOT Family — label it Education or Arts. When unsure between a specific category and Community, prefer the specific one; when unsure whether something is for kids, do NOT default to Family.`;

async function callClaude(items, apiKey) {
  const list = items
    .map((e, i) => `${i + 1}. ${e.title || 'Untitled'}${e.description ? ` — ${String(e.description).slice(0, 200)}` : ''}`)
    .join('\n');

  const body = {
    model: MODEL,
    max_tokens: 1500,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Categorize these ${items.length} events. Return ONLY a JSON array of ${items.length} category strings, one per event in the same order. No other text.\n\n${list}`,
      },
    ],
  };

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || '').join('').trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) throw new Error('no JSON array in response');
  return JSON.parse(text.slice(start, end + 1));
}

function normalize(cat) {
  if (typeof cat === 'string') {
    if (CATEGORIES.includes(cat)) return cat;
    const m = CATEGORIES.find((c) => c.toLowerCase() === cat.trim().toLowerCase());
    if (m) return m;
  }
  return 'Community';
}

// Classify an array of { title, description }. Returns an array of valid category
// strings the same length as the input. Never throws — bad batches default to
// 'Community' so a labeling hiccup can't drop events.
export async function classifyEvents(items, apiKey, { batchSize = 25, onProgress } = {}) {
  const out = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    let cats;
    try {
      cats = await callClaude(batch, apiKey);
    } catch (e) {
      console.error(`  ! classify batch failed (${e.message}); defaulting to Community`);
      cats = batch.map(() => 'Community');
    }
    for (let j = 0; j < batch.length; j++) out.push(normalize(cats[j]));
    if (onProgress) onProgress(Math.min(i + batchSize, items.length), items.length);
  }
  return out;
}
