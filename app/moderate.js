import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Pressable, RefreshControl, ActivityIndicator, Alert, Modal, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ThemedText from '../src/components/ThemedText';
import { useApp } from '../src/context/AppContext';
import { fetchPending, setPostStatus, fetchReported, dismissReports, fetchPendingCalendars, setCalendarStatus } from '../src/lib/db';
import { CITIES } from '../src/data/cities';
import { colors, spacing, radius } from '../src/theme/theme';
import { formatShortDate } from '../src/utils/dates';

const CITY_NAME = Object.fromEntries(CITIES.map((c) => [c.id, c.name]));
const KIND_LABEL = { event: 'EVENT', garage_sale: 'GARAGE SALE', food_truck: 'FOOD TRUCK' };
// Fill tokens: these hues are only ever used as the kind badge's background, and
// its label is textInverse.
const KIND_COLOR = {
  event: colors.primaryFill,
  garage_sale: colors.garageSaleFill,
  food_truck: colors.foodTruckFill,
};

function itemFields(item) {
  return {
    title: item.title || item.name || 'Untitled',
    when: item.start || item.date || item.start_at,
    where: item.venue || item.locationName || item.address,
    detail: item.description || item.note || '',
    submittedBy: item.host || item.submitted_by || '',
    image: item.image_url || item.imageUrl || null,
    town: CITY_NAME[item.cityId] || item.cityId || '',
  };
}

// The tappable body of a queue card — badges, an optional photo thumbnail, and a
// short preview. Tapping it opens the full submission so the moderator can see
// exactly what was posted (full text + photo) before deciding.
function CardBody({ item, reported, onOpen }) {
  const f = itemFields(item);
  const accent = KIND_COLOR[item.kind] || colors.primaryFill;
  return (
    <Pressable onPress={() => onOpen(item, reported)} accessibilityRole="button" accessibilityLabel={`View full ${KIND_LABEL[item.kind] || 'post'}: ${f.title}`}>
      <View style={styles.kindRow}>
        <View style={[styles.kindBadge, { backgroundColor: accent }]}>
          <ThemedText size="tiny" weight="bold" color={colors.textInverse}>{KIND_LABEL[item.kind]}</ThemedText>
        </View>
        {f.town ? (
          <View style={[styles.kindBadge, styles.townBadge]}>
            <Ionicons name="location" size={11} color={colors.text} />
            <ThemedText size="tiny" weight="bold" color={colors.text}>{f.town}</ThemedText>
          </View>
        ) : null}
        {reported ? (
          <View style={[styles.kindBadge, styles.flagBadge]}>
            <ThemedText size="tiny" weight="bold" color={colors.danger}>
              🚩 {item.reportCount} {item.reportCount === 1 ? 'report' : 'reports'}
            </ThemedText>
          </View>
        ) : null}
      </View>

      <View style={styles.bodyRow}>
        {f.image ? (
          <Image source={{ uri: f.image }} style={styles.thumb} resizeMode="cover" />
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText size="subtitle" weight="bold" numberOfLines={2}>{f.title}</ThemedText>
          {reported && item.reasons?.length ? (
            <ThemedText size="small" color={colors.danger} style={{ marginTop: 2 }} numberOfLines={2}>
              Reason: {item.reasons.join(', ')}
            </ThemedText>
          ) : null}
          {f.when ? (
            <View style={styles.metaRow}>
              <Ionicons name="calendar-outline" size={16} color={colors.textMuted} />
              <ThemedText size="small" color={colors.textMuted}>{formatShortDate(f.when)}</ThemedText>
            </View>
          ) : null}
          {f.where ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={16} color={colors.textMuted} />
              <ThemedText size="small" color={colors.textMuted} numberOfLines={1}>{f.where}</ThemedText>
            </View>
          ) : null}
        </View>
      </View>

      {f.detail ? (
        <ThemedText size="small" color={colors.text} style={{ marginTop: 6 }} numberOfLines={2}>{f.detail}</ThemedText>
      ) : null}
      <View style={styles.viewCue}>
        <Ionicons name="eye-outline" size={15} color={colors.primary} />
        <ThemedText size="small" weight="bold" color={colors.primary}>Tap to see the full post</ThemedText>
      </View>
    </Pressable>
  );
}

export default function ModerateScreen() {
  const { isAdmin, refresh, refreshPendingCount } = useApp();
  const [items, setItems] = useState([]);
  const [reported, setReported] = useState([]);
  const [calendars, setCalendars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [preview, setPreview] = useState(null); // { item, reported }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, flagged, cals] = await Promise.all([fetchPending(), fetchReported(), fetchPendingCalendars()]);
      setItems(pending);
      setReported(flagged);
      setCalendars(cals);
    } catch (e) {
      Alert.alert('Could not load', e?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const openPreview = (item, isReported) => setPreview({ item, reported: isReported });
  const closePreview = () => setPreview(null);

  const decide = async (item, status) => {
    setBusyId(item.id);
    try {
      await setPostStatus(item.kind, item.id, status);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      refreshPendingCount();
      refresh(); // refresh public lists (approve adds it, reject removes it)
    } catch (e) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  // Keep a reported listing: clear its reports, leave it published.
  const keepReported = async (item) => {
    setBusyId(item.id);
    try {
      await dismissReports(item.kind, item.id);
      setReported((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  // Approve (start auto-importing) or reject (delete) a pending self-serve calendar.
  const decideCalendar = async (cal, approve) => {
    setBusyId(cal.id);
    try {
      await setCalendarStatus(cal.id, approve);
      setCalendars((prev) => prev.filter((c) => c.id !== cal.id));
      if (approve) refresh(); // approved feed's events flow in on the next aggregate run
    } catch (e) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  // Remove a reported listing: reject it (hides it) and clear its reports.
  const removeReported = async (item) => {
    setBusyId(item.id);
    try {
      await setPostStatus(item.kind, item.id, 'rejected');
      await dismissReports(item.kind, item.id);
      setReported((prev) => prev.filter((i) => i.id !== item.id));
      refresh(); // drop it from the public lists
    } catch (e) {
      Alert.alert('Could not update', e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  if (!isAdmin) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed" size={40} color={colors.textMuted} />
        <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
          This area is for moderators. Sign in with your admin account to review submissions.
        </ThemedText>
      </View>
    );
  }

  const nothing = items.length === 0 && reported.length === 0 && calendars.length === 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
    >
      {loading && nothing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : nothing ? (
        <View style={styles.center}>
          <ThemedText style={{ fontSize: 44 }}>✅</ThemedText>
          <ThemedText size="subtitle" weight="bold">All clear</ThemedText>
          <ThemedText size="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
            Nothing waiting for review. Clean posts go live automatically.
          </ThemedText>
        </View>
      ) : (
        <>
          {/* Reported posts — already live, but someone flagged them. */}
          {reported.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="flag" size={18} color={colors.danger} />
                <ThemedText size="subtitle" weight="bold" color={colors.danger}>
                  Reported ({reported.length})
                </ThemedText>
              </View>
              <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
                These are published but a user flagged them. Tap to review, then keep them up or remove them.
              </ThemedText>

              {reported.map((item) => {
                const busy = busyId === item.id;
                return (
                  <View key={`rep-${item.kind}-${item.id}`} style={[styles.card, styles.reportedCard]}>
                    <CardBody item={item} reported onOpen={openPreview} />
                    <View style={styles.actions}>
                      <Pressable style={[styles.btn, styles.reject, busy && { opacity: 0.5 }]} onPress={() => removeReported(item)} disabled={busy}>
                        <Ionicons name="trash-outline" size={20} color={colors.danger} />
                        <ThemedText size="body" weight="bold" color={colors.danger}>Remove</ThemedText>
                      </Pressable>
                      <Pressable style={[styles.btn, styles.keep, busy && { opacity: 0.5 }]} onPress={() => keepReported(item)} disabled={busy}>
                        {busy ? <ActivityIndicator size="small" color={colors.textInverse} /> : (
                          <>
                            <Ionicons name="checkmark" size={20} color={colors.textInverse} />
                            <ThemedText size="body" weight="bold" color={colors.textInverse}>Keep</ThemedText>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </>
          ) : null}

          {/* Pending calendars — self-serve event feeds waiting to be turned on. */}
          {calendars.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="calendar-outline" size={18} color={colors.accent} />
                <ThemedText size="subtitle" weight="bold">Pending calendars ({calendars.length})</ThemedText>
              </View>
              <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
                An organizer connected their calendar. Approve to start auto-importing their events, or reject it.
              </ThemedText>
              {calendars.map((cal) => {
                const busy = busyId === cal.id;
                return (
                  <View key={`cal-${cal.id}`} style={styles.card}>
                    <View style={styles.kindRow}>
                      <View style={[styles.kindBadge, { backgroundColor: colors.accentFill }]}>
                        <ThemedText size="tiny" weight="bold" color={colors.textInverse}>CALENDAR</ThemedText>
                      </View>
                      {cal.city_id ? (
                        <View style={[styles.kindBadge, styles.townBadge]}>
                          <Ionicons name="location" size={11} color={colors.text} />
                          <ThemedText size="tiny" weight="bold" color={colors.text}>{CITY_NAME[cal.city_id] || cal.city_id}</ThemedText>
                        </View>
                      ) : null}
                    </View>
                    <ThemedText size="subtitle" weight="bold" numberOfLines={2}>{cal.name}</ThemedText>
                    <ThemedText size="small" color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>{cal.url}</ThemedText>
                    <ThemedText size="small" color={colors.textMuted} style={{ marginTop: 2 }}>
                      {(cal.default_category || 'Community')}{cal.submitted_contact ? ` · ${cal.submitted_contact}` : ''}
                    </ThemedText>
                    <View style={styles.actions}>
                      <Pressable style={[styles.btn, styles.reject, busy && { opacity: 0.5 }]} onPress={() => decideCalendar(cal, false)} disabled={busy}>
                        <Ionicons name="close" size={20} color={colors.danger} />
                        <ThemedText size="body" weight="bold" color={colors.danger}>Reject</ThemedText>
                      </Pressable>
                      <Pressable style={[styles.btn, styles.approve, busy && { opacity: 0.5 }]} onPress={() => decideCalendar(cal, true)} disabled={busy}>
                        {busy ? <ActivityIndicator size="small" color={colors.textInverse} /> : (
                          <>
                            <Ionicons name="checkmark" size={20} color={colors.textInverse} />
                            <ThemedText size="body" weight="bold" color={colors.textInverse}>Approve</ThemedText>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </>
          ) : null}

          {/* Pending submissions — held by the auto-filter for a human check. */}
          {items.length > 0 ? (
            <>
              <View style={styles.sectionHeader}>
                <Ionicons name="time-outline" size={18} color={colors.accent} />
                <ThemedText size="subtitle" weight="bold">
                  Pending review ({items.length})
                </ThemedText>
              </View>
              <ThemedText size="small" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
                These passed the automatic filter but looked worth a human check (a link,
                a phone number, or flagged wording). Tap to see the full post, then approve or reject.
              </ThemedText>

              {items.map((item) => {
                const busy = busyId === item.id;
                return (
                  <View key={`${item.kind}-${item.id}`} style={styles.card}>
                    <CardBody item={item} reported={false} onOpen={openPreview} />
                    <View style={styles.actions}>
                      <Pressable style={[styles.btn, styles.reject, busy && { opacity: 0.5 }]} onPress={() => decide(item, 'rejected')} disabled={busy}>
                        <Ionicons name="close" size={20} color={colors.danger} />
                        <ThemedText size="body" weight="bold" color={colors.danger}>Reject</ThemedText>
                      </Pressable>
                      <Pressable style={[styles.btn, styles.approve, busy && { opacity: 0.5 }]} onPress={() => decide(item, 'approved')} disabled={busy}>
                        {busy ? <ActivityIndicator size="small" color={colors.textInverse} /> : (
                          <>
                            <Ionicons name="checkmark" size={20} color={colors.textInverse} />
                            <ThemedText size="body" weight="bold" color={colors.textInverse}>Approve</ThemedText>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </>
          ) : null}
        </>
      )}

      {/* Full-post preview — what the submitter actually posted. */}
      <PreviewModal
        preview={preview}
        busy={preview ? busyId === preview.item.id : false}
        onClose={closePreview}
        onApprove={(item) => { decide(item, 'approved'); closePreview(); }}
        onReject={(item) => { decide(item, 'rejected'); closePreview(); }}
        onKeep={(item) => { keepReported(item); closePreview(); }}
        onRemove={(item) => { removeReported(item); closePreview(); }}
      />
    </ScrollView>
  );
}

function PreviewModal({ preview, busy, onClose, onApprove, onReject, onKeep, onRemove }) {
  if (!preview) return null;
  const { item, reported } = preview;
  const f = itemFields(item);
  const accent = KIND_COLOR[item.kind] || colors.primaryFill;
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalScreen}>
        <View style={styles.modalHead}>
          <View style={[styles.kindBadge, { backgroundColor: accent }]}>
            <ThemedText size="tiny" weight="bold" color={colors.textInverse}>{KIND_LABEL[item.kind]}</ThemedText>
          </View>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close preview">
            <Ionicons name="close" size={28} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
          {f.image ? (
            <Image source={{ uri: f.image }} style={styles.modalImage} resizeMode="cover" />
          ) : null}
          <ThemedText size="title" weight="bold" style={{ marginTop: f.image ? spacing.md : 0 }}>{f.title}</ThemedText>

          {reported && item.reasons?.length ? (
            <View style={[styles.kindBadge, styles.flagBadge, { alignSelf: 'flex-start', marginTop: spacing.sm }]}>
              <ThemedText size="small" weight="bold" color={colors.danger}>🚩 Reported: {item.reasons.join(', ')}</ThemedText>
            </View>
          ) : null}

          {f.town ? (
            <View style={[styles.metaRow, { marginTop: spacing.sm }]}>
              <Ionicons name="location" size={18} color={colors.primary} />
              <ThemedText size="body" weight="semibold" color={colors.primary}>{f.town}</ThemedText>
            </View>
          ) : null}
          {f.when ? (
            <View style={[styles.metaRow, { marginTop: f.town ? 2 : spacing.sm }]}>
              <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
              <ThemedText size="body" color={colors.textMuted}>{formatShortDate(f.when)}</ThemedText>
            </View>
          ) : null}
          {f.where ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={18} color={colors.textMuted} />
              <ThemedText size="body" color={colors.textMuted}>{f.where}</ThemedText>
            </View>
          ) : null}
          {f.submittedBy ? (
            <View style={styles.metaRow}>
              <Ionicons name="person-outline" size={18} color={colors.textMuted} />
              <ThemedText size="body" color={colors.textMuted}>Submitted by {f.submittedBy}</ThemedText>
            </View>
          ) : null}

          {f.detail ? (
            <ThemedText size="body" color={colors.text} style={{ marginTop: spacing.md, lineHeight: 26 }}>{f.detail}</ThemedText>
          ) : (
            <ThemedText size="small" color={colors.textMuted} style={{ marginTop: spacing.md }}>No description provided.</ThemedText>
          )}
        </ScrollView>

        <View style={[styles.actions, styles.modalActions]}>
          {reported ? (
            <>
              <Pressable style={[styles.btn, styles.reject, busy && { opacity: 0.5 }]} onPress={() => onRemove(item)} disabled={busy}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
                <ThemedText size="body" weight="bold" color={colors.danger}>Remove</ThemedText>
              </Pressable>
              <Pressable style={[styles.btn, styles.keep, busy && { opacity: 0.5 }]} onPress={() => onKeep(item)} disabled={busy}>
                <Ionicons name="checkmark" size={20} color={colors.textInverse} />
                <ThemedText size="body" weight="bold" color={colors.textInverse}>Keep</ThemedText>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable style={[styles.btn, styles.reject, busy && { opacity: 0.5 }]} onPress={() => onReject(item)} disabled={busy}>
                <Ionicons name="close" size={20} color={colors.danger} />
                <ThemedText size="body" weight="bold" color={colors.danger}>Reject</ThemedText>
              </Pressable>
              <Pressable style={[styles.btn, styles.approve, busy && { opacity: 0.5 }]} onPress={() => onApprove(item)} disabled={busy}>
                <Ionicons name="checkmark" size={20} color={colors.textInverse} />
                <ThemedText size="body" weight="bold" color={colors.textInverse}>Approve</ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  reportedCard: { borderColor: colors.danger, borderWidth: 1.5 },
  kindRow: { flexDirection: 'row', marginBottom: 2, gap: 6, flexWrap: 'wrap' },
  kindBadge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  townBadge: { backgroundColor: colors.surfaceAlt, flexDirection: 'row', alignItems: 'center', gap: 3 },
  flagBadge: { backgroundColor: colors.accentLight },
  bodyRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  viewCue: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    minHeight: 50,
  },
  reject: { borderWidth: 1.5, borderColor: colors.danger, backgroundColor: colors.surface },
  approve: { backgroundColor: colors.success },
  keep: { backgroundColor: colors.primaryFill },
  modalScreen: { flex: 1, backgroundColor: colors.background },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalImage: { width: '100%', height: 220, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  modalActions: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 0,
  },
});
