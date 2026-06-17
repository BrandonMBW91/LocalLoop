import React, { useMemo, useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from '../src/components/ThemedText';
import EventCard from '../src/components/EventCard';
import EmptyState from '../src/components/EmptyState';
import { useApp } from '../src/context/AppContext';
import { colors, spacing, radius } from '../src/theme/theme';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// A local yyyy-mm-dd key for a Date (so events land on the right calendar day
// regardless of timezone offsets in the ISO string).
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CalendarScreen() {
  const { events, city } = useApp();
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });
  const [selected, setSelected] = useState(dayKey(today));

  // Bucket all loaded events by their local day key.
  const byDay = useMemo(() => {
    const map = {};
    for (const e of events) {
      const k = dayKey(new Date(e.start));
      (map[k] = map[k] || []).push(e);
    }
    return map;
  }, [events]);

  // Build the 6-row grid of day cells for the visible month.
  const cells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const startPad = first.getDay(); // 0=Sun
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < startPad; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(cursor.y, cursor.m, d);
      const k = dayKey(date);
      out.push({ d, k, count: (byDay[k] || []).length, isToday: k === dayKey(today) });
    }
    return out;
  }, [cursor, byDay]);

  const move = (delta) => {
    setCursor((c) => {
      const nm = c.m + delta;
      return { y: c.y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 };
    });
  };

  const dayEvents = byDay[selected] || [];
  const selDate = selected ? new Date(selected + 'T00:00:00') : null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
      <ThemedText size="small" color={colors.textMuted} style={styles.sub}>
        Events in {city.name}
      </ThemedText>

      {/* Month switcher */}
      <View style={styles.monthRow}>
        <Pressable onPress={() => move(-1)} hitSlop={12} style={styles.arrow} accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </Pressable>
        <ThemedText size="subtitle" weight="bold">{MONTHS[cursor.m]} {cursor.y}</ThemedText>
        <Pressable onPress={() => move(1)} hitSlop={12} style={styles.arrow} accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={24} color={colors.primary} />
        </Pressable>
      </View>

      {/* Weekday header */}
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <ThemedText key={i} size="tiny" weight="bold" color={colors.textMuted} style={styles.weekCell}>{w}</ThemedText>
        ))}
      </View>

      {/* Day grid */}
      <View style={styles.grid}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={i} style={styles.cell} />;
          const isSel = cell.k === selected;
          const has = cell.count > 0;
          return (
            <Pressable
              key={i}
              style={styles.cell}
              onPress={() => setSelected(cell.k)}
              accessibilityLabel={`${MONTHS[cursor.m]} ${cell.d}, ${cell.count} events`}
            >
              <View style={[styles.dayBubble, cell.isToday && styles.today, isSel && styles.selected]}>
                <ThemedText
                  size="body"
                  weight={isSel || cell.isToday ? 'bold' : 'regular'}
                  color={isSel ? colors.textInverse : has ? colors.text : colors.textMuted}
                >
                  {cell.d}
                </ThemedText>
              </View>
              <View style={[styles.dot, has && { backgroundColor: isSel ? colors.accent : colors.primary }]} />
            </Pressable>
          );
        })}
      </View>

      {/* Selected day's events */}
      <View style={styles.list}>
        <ThemedText size="subtitle" weight="bold" style={{ marginBottom: spacing.sm }}>
          {selDate ? selDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''}
        </ThemedText>
        {dayEvents.length === 0 ? (
          <EmptyState icon="calendar-outline" title="Nothing on this day" body="Pick another day with a dot, or browse the full list." />
        ) : (
          dayEvents
            .sort((a, b) => new Date(a.start) - new Date(b.start))
            .map((e) => <EventCard key={e.id} event={e} />)
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  sub: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  monthRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  arrow: { padding: 4 },
  weekRow: { flexDirection: 'row', paddingHorizontal: spacing.sm },
  weekCell: { width: `${100 / 7}%`, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.sm },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 4 },
  dayBubble: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
  },
  today: { borderWidth: 1.5, borderColor: colors.primary },
  selected: { backgroundColor: colors.primary },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 2, backgroundColor: 'transparent' },
  list: { paddingHorizontal: spacing.md, paddingTop: spacing.lg },
});
