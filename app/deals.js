import React, { useState } from 'react';
import { View, FlatList, StyleSheet, RefreshControl } from 'react-native';
import ThemedText from '../src/components/ThemedText';
import DealCard from '../src/components/DealCard';
import EmptyState from '../src/components/EmptyState';
import { useApp } from '../src/context/AppContext';
import { colors, spacing } from '../src/theme/theme';

export default function DealsScreen() {
  const { city, deals, refresh } = useApp();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={deals}
        keyExtractor={(d) => d.id}
        renderItem={({ item }) => <DealCard deal={item} />}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
        ListHeaderComponent={
          deals.length ? (
            <ThemedText size="small" color={colors.textMuted} style={styles.intro}>
              Deals and specials from businesses in {city.name}. Tap through to visit or call.
            </ThemedText>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="pricetags-outline"
            title="No deals right now"
            body={`When local businesses post a special in ${city.name}, it shows up here.`}
            accent={colors.accent}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  intro: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
});
