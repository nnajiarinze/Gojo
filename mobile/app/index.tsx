import React, { useState } from 'react';
import { ActivityIndicator, Alert, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useReceiptStore } from '../src/store/receiptStore';
import { getReceiptImage, ReceiptImagePermissionError, ReceiptImageValidationError } from '../src/services/receiptImage';

export default function HomeScreen() {
  const router = useRouter();
  const reset = useReceiptStore((s) => s.reset);
  const parserMode = useReceiptStore((s) => s.parserMode);
  const setReceiptImage = useReceiptStore((s) => s.setReceiptImage);
  const [choosingGallery, setChoosingGallery] = useState(false);

  const handleScan = () => {
    reset();
    router.push('/camera');
  };

  const handleChooseGallery = async () => {
    setChoosingGallery(true);
    try {
      const image = await getReceiptImage({ source: 'gallery' });
      if (!image) return;
      reset();
      setReceiptImage(image);
      router.push('/processing');
    } catch (err: any) {
      const title = err instanceof ReceiptImagePermissionError
        ? 'Photo Access Needed'
        : err instanceof ReceiptImageValidationError
          ? 'Unsupported Image'
          : 'Could Not Choose Image';
      Alert.alert(title, err?.message ?? 'Please try another image.');
    } finally {
      setChoosingGallery(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>📄</Text>
        <Text style={styles.title}>Gojo</Text>
        <Text style={styles.subtitle}>Receipt → Invoice in seconds</Text>
        <Text style={styles.parserBadge}>
          Parser: {parserMode === 'gojo' ? 'Gojo demo parser' : 'Generic parser'}
        </Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleScan} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Take Photo</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.galleryBtn, choosingGallery && styles.disabledBtn]}
        onPress={handleChooseGallery}
        activeOpacity={0.8}
        disabled={choosingGallery}
      >
        {choosingGallery ? (
          <ActivityIndicator color="#111827" />
        ) : (
          <Text style={styles.galleryBtnText}>Choose from Gallery</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.historyBtn}
        onPress={() => router.push('/history')}
        activeOpacity={0.8}
      >
        <Text style={styles.historyBtnText}>Invoice History</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => router.push('/settings')}
        activeOpacity={0.8}
      >
        <Text style={styles.settingsBtnText}>Settings</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#F9FAFB',
  },
  hero: { alignItems: 'center', marginBottom: 64 },
  logo: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 36, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 16, color: '#6B7280', marginTop: 8 },
  parserBadge: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#EEF2FF',
    color: '#3730A3',
    fontSize: 13,
    fontWeight: '700',
  },
  button: {
    backgroundColor: '#111827',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  galleryBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
  },
  galleryBtnText: { color: '#111827', fontSize: 16, fontWeight: '700' },
  disabledBtn: { opacity: 0.65 },
  historyBtn: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
  },
  historyBtnText: { color: '#374151', fontSize: 16, fontWeight: '600' },
  settingsBtn: {
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
  },
  settingsBtnText: { color: '#6B7280', fontSize: 16, fontWeight: '600' },
});
