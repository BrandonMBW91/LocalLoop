// The ONE place a town turns into a price.
//
// WHY IT EXISTS. app/(tabs)/index.js used to render the hardcoded string
// "Put your business here from $19/mo" while every other price surface derived its
// number at runtime from that town's real monthly active users. $19 is the Founding
// rate, so the sentence was accidentally true in 134 towns and false in Findlay, which
// crossed 250 users into the Local tier ($29). A business owner there was promised $19
// on the home tab and shown $29 the moment they tapped through.
//
// The dangerous part was never Findlay. It was that nothing structural kept the other
// 134 honest: New Philadelphia (183) and Canton (162) start telling the same lie the
// day they cross 250, with no code change and no deploy. A price is a promise, so it
// has to be computed from the same input as the checkout link, not typed into prose.
//
// users === null means UNKNOWN (still loading, or the RPC failed). Callers must then
// render NO price and NO buy link. Never fall back to rateForUsers(0): that is
// Founding $19, i.e. exactly the wrong answer for the only town where it matters.
import { useEffect, useState } from 'react';
import { fetchCityUsers } from '../lib/db';
import { rateForUsers } from '../data/pricing';
import { CHECKOUT_BY_TIER, CHECKOUT_ANNUAL_BY_TIER } from '../data/checkout';

// Per-session cache, so the home tab and the advertise screen cannot disagree about
// the same town and the count is not re-fetched on every render of the house ad.
const seen = new Map();

export function useTownRate(cityId, enabled = true) {
  const [users, setUsers] = useState(() => (seen.has(cityId) ? seen.get(cityId) : null));

  useEffect(() => {
    let alive = true;
    // Switching towns means the new town's count is unknown until it arrives —
    // showing the previous town's price for a moment is the same bug in miniature.
    setUsers(seen.has(cityId) ? seen.get(cityId) : null);
    if (!enabled || seen.has(cityId)) return undefined;
    fetchCityUsers(cityId)
      .then((n) => { if (n != null && alive) { seen.set(cityId, n); setUsers(n); } })
      .catch(() => {}); // stays unknown, which renders no price — the safe direction
    return () => { alive = false; };
  }, [cityId, enabled]);

  const known = users != null;
  const rate = rateForUsers(users || 0);
  const links = known ? CHECKOUT_BY_TIER[rate.name] || null : null;
  return {
    known,
    users,
    rate,
    links,
    buyable: !!links,
    sponsor: known ? rate.sponsor : null,
    annualTown: known ? CHECKOUT_ANNUAL_BY_TIER[rate.name]?.town || null : null,
  };
}
