// Is this event kids/family programming? Powers the "Hide kids" filter on the
// events feed.
//
// Two signals. The category is the primary one: 'Family' is the app's kids/family
// bucket (storytimes, tween clubs, family fun). But a lot of library kids' programs
// get tagged 'Education' or 'Arts' instead, so a keyword sweep on the title catches
// those. The keyword list is kept TIGHT and genuinely child-specific on purpose:
// "all ages" and "family friendly" are deliberately excluded because an adult may
// still want those (a free all-ages concert), and hiding them would over-filter.
const KIDS_RE = new RegExp(
  '\\b(' + [
    'kids?', 'children', "children's", 'toddlers?', 'preschool(ers)?', 'pre-?k',
    'kindergarten', 'elementary', 'storytimes?', 'story time', 'lap ?sit',
    'babys?', 'babies', 'infants?', 'tweens?', 'youth', 'little ones',
    'lego club', 'kids craft', 'read to a dog', 'homeschool', 'stem for kids',
    'puppet show', 'petting zoo', 'storybook', 'bounce house', 'face painting',
  ].join('|') + ')\\b',
  'i',
);

export function isKidsEvent(e) {
  if (!e) return false;
  if (e.category === 'Family') return true;
  return KIDS_RE.test(e.title || '');
}
