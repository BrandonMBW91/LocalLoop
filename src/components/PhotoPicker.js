import React from 'react';
import { View, StyleSheet, Pressable, Image, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import ThemedText from './ThemedText';
import { colors, spacing, radius } from '../theme/theme';

// Lets a user attach up to `max` photos. Returns picked photos as an array of
// { uri, base64 } objects via onChange. base64 is used to upload to the backend
// when one is configured; the uri is for on-device preview.
export default function PhotoPicker({ photos = [], onChange, max = 4, accent = colors.primary }) {
  const pick = async () => {
    if (photos.length >= max) {
      Alert.alert('Photo limit', `You can add up to ${max} photos.`);
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted && perm.canAskAgain === false) {
      Alert.alert(
        'Permission needed',
        'Please allow photo access in your settings to add pictures.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
      allowsMultipleSelection: true,
      selectionLimit: max - photos.length,
    });

    if (result.canceled) return;
    const picked = (result.assets || []).map((a) => ({ uri: a.uri, base64: a.base64 }));
    onChange([...photos, ...picked].slice(0, max));
  };

  const remove = (index) => onChange(photos.filter((_, i) => i !== index));

  return (
    <View>
      <ThemedText size="tiny" color={colors.textMuted} style={styles.count}>
        {photos.length} of {max} added
      </ThemedText>
      <View style={styles.wrap}>
        {photos.map((p, i) => (
          <View key={p.uri || i} style={styles.thumb}>
            <Image source={{ uri: p.uri }} style={styles.img} resizeMode="cover" />
            <Pressable
              onPress={() => remove(i)}
              style={styles.removeBtn}
              hitSlop={10}
              accessibilityLabel={`Remove photo ${i + 1}`}
            >
              <Ionicons name="close" size={16} color={colors.textInverse} />
            </Pressable>
          </View>
        ))}

        {photos.length < max ? (
          <Pressable
            onPress={pick}
            style={[styles.addBtn, { borderColor: accent, backgroundColor: accent + '12' }]}
            accessibilityRole="button"
            accessibilityLabel="Add a photo"
          >
            <View style={[styles.addIcon, { backgroundColor: accent }]}>
              <Ionicons name="camera" size={24} color={colors.textInverse} />
            </View>
            <ThemedText size="tiny" weight="bold" color={accent}>
              Add photo
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const SIZE = 100;

const styles = StyleSheet.create({
  count: { marginBottom: 6 },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingTop: 8, // room so the remove button isn't clipped
    paddingRight: 8,
  },
  thumb: {
    width: SIZE,
    height: SIZE,
  },
  img: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  removeBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  addBtn: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  addIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
