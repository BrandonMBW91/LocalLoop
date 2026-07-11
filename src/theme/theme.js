// Central design tokens. Tuned for an older audience: high contrast,
// generous spacing, large default type, big tap targets.
//
// #6 DARK MODE: the palette is resolved ONCE at module load from the OS color
// scheme (Appearance). Every screen does `import { colors }` and holds this same
// object reference, so building `colors` here — before any component renders —
// themes the whole app with no per-component refactor. It follows the OS setting
// at launch (needs app.json ios.userInterfaceStyle:"automatic"); a live in-app
// toggle would need a reload and is intentionally out of scope. Category hues are
// shared (they read on both grounds); only surfaces/text/border invert.
import { Appearance } from 'react-native';

const CATEGORY = {
  Music: '#6A3FB0', Family: '#1C6A9E', Food: '#9E4E0F', Sports: '#15723C',
  Arts: '#A62E6B', Community: '#1F6566', Market: '#786017', Education: '#34509E',
};
const CATEGORY_DARK = {
  // Lightened for legible pill text on dark tints.
  Music: '#B79BEA', Family: '#7FC0EC', Food: '#E0A26A', Sports: '#78C98A',
  Arts: '#E58BC0', Community: '#6FC6C7', Market: '#D8C06A', Education: '#9DBBEE',
};

const LIGHT = {
  primary: '#15315B', primaryDark: '#0E2444', primaryLight: '#E8EDF5',
  accent: '#B22234', accentLight: '#FBE7E9',
  background: '#FBF8F1', surface: '#FFFFFF', surfaceAlt: '#F3EFE6',
  text: '#1A1A1A', textMuted: '#5B5B5B', textInverse: '#FFFFFF',
  border: '#E4DED4', shadow: '#000000', skeleton: '#ECE9E2',
  success: '#256B29', successBg: '#E7F1E8', danger: '#C0392B',
  garageSale: '#9A4A18', garageSaleLight: '#FBEFE4',
  foodTruck: '#B5363B', foodTruckLight: '#FBE9EA',
  category: CATEGORY,
};

const DARK = {
  // primary is used BOTH as a button fill (white text on it) and as an on-surface
  // icon/text color, so it's a mid navy that reads acceptably in both roles on
  // dark ground. accent likewise nudged lighter for the same dual use.
  primary: '#5B8AD1', primaryDark: '#3B5C94', primaryLight: '#1C2A44',
  accent: '#E06A73', accentLight: '#3A1E22',
  background: '#0F1729', surface: '#182238', surfaceAlt: '#202C46',
  // textInverse sits on the saturated primary/accent/garageSale/foodTruck fills
  // (which stay colored in both themes), so it stays white — NOT the dark ground.
  text: '#E8ECF4', textMuted: '#98A4BA', textInverse: '#FFFFFF',
  border: '#2A3650', shadow: '#000000', skeleton: '#20293C',
  success: '#5BC98A', successBg: '#18301F', danger: '#E06A6A',
  garageSale: '#D89A5A', garageSaleLight: '#2A2116',
  foodTruck: '#E0787C', foodTruckLight: '#2E1A1C',
  category: CATEGORY_DARK,
};

export const isDark = Appearance.getColorScheme() === 'dark';
export const colors = isDark ? { ...DARK } : { ...LIGHT };

// Layout spacing scale — use these tokens for gaps, padding, and margins so the
// whole app shares one rhythm and can be retuned in one place. `xxs` is the tight
// half-step (pill/badge padding, micro-gaps). A few component-internal values that
// fall between rungs (e.g. a 6px icon-to-label gap, a control's 10-12px vertical
// padding) are intentionally left as literals rather than inventing off-scale
// tokens — tokenize the scale, not every pixel.
export const spacing = {
  xxs: 2,
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
