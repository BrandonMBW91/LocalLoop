import React from 'react';
import { colors, radius } from '../theme/theme';

// Web fallback: a real HTML date/time input (the phone uses the native picker).
export default function DateTimeField({ value, onChange, mode = 'date', accent = colors.primary }) {
  const pad = (n) => String(n).padStart(2, '0');

  const toInputValue = (d) => {
    if (!d) return '';
    return mode === 'date'
      ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handle = (e) => {
    const v = e.target.value;
    if (!v) return;
    const base = value ? new Date(value) : new Date();
    if (mode === 'date') {
      const [y, m, dd] = v.split('-').map(Number);
      base.setFullYear(y, m - 1, dd);
    } else {
      const [hh, mm] = v.split(':').map(Number);
      base.setHours(hh, mm, 0, 0);
    }
    onChange(base);
  };

  return React.createElement('input', {
    type: mode === 'date' ? 'date' : 'time',
    value: toInputValue(value),
    onChange: handle,
    style: {
      padding: 14,
      fontSize: 18,
      borderRadius: radius.md,
      border: `1.5px solid ${colors.border}`,
      color: colors.text,
      backgroundColor: colors.surface,
      minHeight: 52,
      width: '100%',
      boxSizing: 'border-box',
      fontFamily: 'inherit',
    },
  });
}
