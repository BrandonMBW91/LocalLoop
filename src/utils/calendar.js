// Build an "Add to Calendar" link. Uses Google Calendar's template URL, which
// opens the user's calendar app on a phone (or the web calendar) — no native
// module required, so it works in Expo Go, the web preview, and production.

function toUTCBasic(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

export function addToCalendarUrl({ title, start, end, location, details }) {
  const startD = new Date(start);
  // Default to a 2-hour block when there's no explicit end time.
  const endD = end ? new Date(end) : new Date(startD.getTime() + 2 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title || 'Event',
    dates: `${toUTCBasic(startD)}/${toUTCBasic(endD)}`,
    location: location || '',
    details: details || '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
