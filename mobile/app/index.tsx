import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useReceiptStore } from '../src/store/receiptStore';

export default function HomeScreen() {
  const router = useRouter();
  const reset = useReceiptStore((s) => s.reset);

  const handleScan = () => {
    reset();
    router.push('/camera');
  };

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.logo}>📄</Text>
        <Text style={styles.title}>Gojo</Text>
        <Text style={styles.subtitle}>Receipt → Invoice in seconds</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleScan} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Scan Receipt</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.historyBtn}
        onPress={() => router.push('/history')}
        activeOpacity={0.8}
      >
        <Text style={styles.historyBtnText}>Invoice History</Text>
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
  button: {
    backgroundColor: '#111827',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
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
});
