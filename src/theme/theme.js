// Central design tokens. Tuned for an older audience: high contrast,
// generous spacing, large default type, big tap targets.

export const colors = {
  // Brand: PATRIOTIC — refined red / white / blue (Jul 2026 seasonal).
  // Navy primary, classic flag red accent, warm cream surfaces. Contrast checked
  // for WCAG AA. To flip back to the original green civic palette, restore the
  // values in the `REVERT:` comments (one commit).
  primary: '#15315B', // deep navy  (REVERT: '#1F6F54')
  primaryDark: '#0E2444', //          (REVERT: '#15503D')
  primaryLight: '#E8EDF5', // light navy tint  (REVERT: '#E7F2EE')
  accent: '#B22234', // classic flag red for CTAs. Clears WCAG AA as white-on-accent
  // (buttons, ~6.6:1) and as accent text on accentLight (FEATURED pill, ~5.6:1).
  // (REVERT: '#A0500F')
  accentLight: '#FBE7E9', // light red tint  (REVERT: '#FBEBDD')

  background: '#FBF8F1', // warm cream  (REVERT: '#FBFAF7')
  surface: '#FFFFFF',
  surfaceAlt: '#F3EFE6', //             (REVERT: '#F2F0EB')

  text: '#1A1A1A',
  textMuted: '#5B5B5B',
  textInverse: '#FFFFFF',

  border: '#E4DED4', //                 (REVERT: '#E2DED7')
  shadow: '#000000',

  success: '#256B29', // darkened so it clears WCAG AA on the light "when" chips
  danger: '#C0392B',

  // Garage sales get their own identity (distinct from event categories).
  garageSale: '#9A4A18', // darkened for AA on garageSaleLight chip
  garageSaleLight: '#FBEFE4',

  // Food trucks — a warm, appetizing red.
  foodTruck: '#B5363B',
  foodTruckLight: '#FBE9EA',

  // Category accent colors — darkened so the colored pill text clears WCAG AA
  // (4.5:1) on its own faint tint background on every card.
  category: {
    Music: '#6A3FB0',
    Family: '#1C6A9E',
    Food: '#9E4E0F',
    Sports: '#15723C',
    Arts: '#A62E6B',
    Community: '#1F6566',
    Market: '#786017',
    Education: '#34509E',
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 8,
  md: 14,
  lg: 22,
  pill: 999,
};

// Base font sizes BEFORE the user's accessibility scale is applied.
// Already larger than a typical app default.
export const baseFont = {
  tiny: 14,
  small: 15,
  body: 18,
  subtitle: 20,
  title: 24,
  large: 30,
  huge: 38,
};

// Text-size options shown in Settings. Multiplies every font size.
export const textScaleOptions = [
  { key: 'normal', label: 'Normal', scale: 1.0 },
  { key: 'large', label: 'Large', scale: 1.18 },
  { key: 'xlarge', label: 'Extra Large', scale: 1.38 },
];

export function categoryColor(category) {
  return colors.category[category] || colors.primary;
}

// Ionicons name per category — used for the event detail hero so it matches the
// app's icon language and renders consistently (unlike emoji on older Androids).
export const categoryIcons = {
  Music: 'musical-notes',
  Family: 'people',
  Food: 'restaurant',
  Sports: 'trophy',
  Arts: 'color-palette',
  Community: 'heart',
  Market: 'cart',
  Education: 'school',
};

export function categoryIcon(category) {
  return categoryIcons[category] || 'calendar';
}
