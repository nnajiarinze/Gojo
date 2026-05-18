import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useReceiptStore, type ParserMode } from '../src/store/receiptStore';

const OPTIONS: Array<{
  mode: ParserMode;
  title: string;
  subtitle: string;
  badge: string;
}> = [
  {
    mode: 'gojo',
    title: 'Gojo demo parser',
    subtitle: 'Uses the original strict Gojo/restaurant parser for demos where the receipt format is known.',
    badge: 'Best for restaurant demo',
  },
  {
    mode: 'generic',
    title: 'Generic parser',
    subtitle: 'Uses the new offline generic parser for grocery stores and unknown receipt layouts.',
    badge: 'Best for testing',
  },
];

export default function SettingsScreen() {
  const parserMode = useReceiptStore((state) => state.parserMode);
  const setParserMode = useReceiptStore((state) => state.setParserMode);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Parser Mode</Text>
      <Text style={styles.description}>
        Choose which receipt parser the scanner uses. This setting is kept when you scan another receipt.
      </Text>

      <View style={styles.card}>
        {OPTIONS.map((option) => {
          const selected = parserMode === option.mode;
          return (
            <TouchableOpacity
              key={option.mode}
              style={[styles.option, selected && styles.optionSelected]}
              onPress={() => setParserMode(option.mode)}
              activeOpacity={0.8}
            >
              <View style={styles.optionHeader}>
                <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                  {option.title}
                </Text>
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected && <View style={styles.radioDot} />}
                </View>
              </View>
              <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
              <Text style={[styles.badge, selected && styles.badgeSelected]}>{option.badge}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>Current mode</Text>
        <Text style={styles.noteText}>
          {parserMode === 'gojo'
            ? 'Scans will use the strict Gojo parser until you switch back.'
            : 'Scans will use the generic parser until you switch back.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#F9FAFB',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
    marginTop: 12,
  },
  description: {
    fontSize: 15,
    color: '#6B7280',
    lineHeight: 22,
    marginTop: 8,
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  option: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 8,
  },
  optionSelected: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  optionTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
  },
  optionTitleSelected: {
    color: '#3730A3',
  },
  optionSubtitle: {
    color: '#6B7280',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
  },
  badge: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
    color: '#4B5563',
    fontSize: 12,
    fontWeight: '700',
  },
  badgeSelected: {
    backgroundColor: '#C7D2FE',
    color: '#312E81',
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: '#4F46E5',
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4F46E5',
  },
  noteCard: {
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  noteTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#065F46',
    marginBottom: 4,
  },
  noteText: {
    fontSize: 14,
    color: '#047857',
    lineHeight: 20,
  },
});
