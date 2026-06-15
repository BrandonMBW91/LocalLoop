// Central design tokens. Tuned for an older audience: high contrast,
// generous spacing, large default type, big tap targets.

export const colors = {
  // Brand: warm, friendly, civic.
  primary: '#1F6F54', // deep green (Findlay parks / Flag City feel)
  primaryDark: '#15503D',
  primaryLight: '#E7F2EE',
  accent: '#D9772B', // warm orange for calls-to-action
  accentLight: '#FBEBDD',

  background: '#FBFAF7',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F0EB',

  text: '#1A1A1A',
  textMuted: '#5B5B5B',
  textInverse: '#FFFFFF',

  border: '#E2DED7',
  shadow: '#000000',

  success: '#2E7D32',
  danger: '#C0392B',

  // Garage sales get their own identity (distinct from event categories).
  garageSale: '#B0561E',
  garageSaleLight: '#FBEFE4',

  // Food trucks — a warm, appetizing red.
  foodTruck: '#B5363B',
  foodTruckLight: '#FBE9EA',

  // Category accent colors (kept distinct + readable).
  category: {
    Music: '#7B4FBF',
    Family: '#2E86C1',
    Food: '#D9772B',
    Sports: '#1F8A4C',
    Arts: '#C0397B',
    Community: '#2C7A7B',
    Market: '#9A7B1F',
    Education: '#3A5BBF',
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
  tiny: 13,
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
