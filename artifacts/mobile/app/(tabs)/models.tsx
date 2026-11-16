import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { PROVIDERS, getConnectedProviderIds, type ProviderId } from '@/lib/assistant/providerManager';
import * as SecureStore from 'expo-secure-store';

type ModelChoice = { providerId: ProviderId; modelId: string; label: string };
const MODEL_KEY = 'badboy.ai.default-model.v1';
const CUSTOM_KEY = 'badboy.ai.custom-models.v1';

export default function DefaultModelsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [connected, setConnected] = useState<ProviderId[]>([]);
  const [selected, setSelected] = useState<ModelChoice | null>(null);
  const [customModels, setCustomModels] = useState<ModelChoice[]>([]);
  const [providerId, setProviderId] = useState<ProviderId>('openrouter');
  const [modelId, setModelId] = useState('');

  useEffect(() => {
    void getConnectedProviderIds().then(setConnected);
    void SecureStore.getItemAsync(MODEL_KEY).then((raw) => { if (raw) { try { setSelected(JSON.parse(raw)); } catch {} } });
    void SecureStore.getItemAsync(CUSTOM_KEY).then((raw) => { if (raw) { try { setCustomModels(JSON.parse(raw)); } catch {} } });
  }, []);

  const choose = async (choice: ModelChoice) => {
    setSelected(choice);
    await SecureStore.setItemAsync(MODEL_KEY, JSON.stringify(choice));
    Alert.alert('Default Model সেট হয়েছে', choice.modelId);
  };
  const addCustom = async (targetProviderId: ProviderId) => {
    const id = modelId.trim();
    if (!id) return;
    const next = [...customModels.filter((item) => !(item.providerId === targetProviderId && item.modelId === id)), { providerId: targetProviderId, modelId: id, label: id }];
    setCustomModels(next);
    await SecureStore.setItemAsync(CUSTOM_KEY, JSON.stringify(next));
    setModelId('');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 18, paddingTop: Math.max(insets.top, 12) + 12, paddingBottom: 36, gap: 12 }}>
      <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}><Feather name="arrow-left" size={19} color={colors.foreground}/><Text style={{ color: colors.foreground, fontWeight: '700' }}>Model Provider</Text></Pressable>
      <Text style={[styles.title, { color: colors.foreground }]}>Default Models</Text>
      <Text style={{ color: colors.mutedForeground, lineHeight: 20 }}>Badboy AI-এর জন্য default provider ও model নির্বাচন করো। Connected provider-ই এখানে দেখানো হবে।</Text>
      {connected.length === 0 ? <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={{ color: colors.mutedForeground }}>এখনো কোনো Provider Key সংরক্ষণ করা হয়নি। আগে Model Provider থেকে সংযোগ করো।</Text></View> : null}
      {connected.map((id) => {
        const provider = PROVIDERS.find((item) => item.id === id);
        if (!provider) return null;
        const active = selected?.providerId === id;
        return <View key={id} style={[styles.card, { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border }]}>
          <View style={styles.row}><Text style={[styles.name, { color: colors.foreground, flex: 1 }]}>{provider.name}</Text>{active ? <Feather name="check-circle" color={colors.primary} size={18}/> : null}</View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>Model ID manually add করো; model ID provider-এর official list থেকে নেবে।</Text>
          {customModels.filter((item) => item.providerId === id).map((item) => <Pressable key={item.modelId} onPress={() => void choose(item)} style={[styles.modelRow, { borderColor: colors.border }]}><Text style={{ color: colors.foreground, flex: 1 }}>{item.modelId}</Text><Feather name={selected?.modelId === item.modelId && selected.providerId === id ? 'check-circle' : 'circle'} color={colors.primary} size={17}/></Pressable>)}
          <View style={{ flexDirection: 'row', gap: 7, marginTop: 9 }}>
            <TextInput value={providerId === id ? modelId : ''} onFocus={() => setProviderId(id)} onChangeText={(value) => { setProviderId(id); setModelId(value); }} placeholder="Model ID (e.g. provider/model)" placeholderTextColor={colors.mutedForeground} autoCapitalize="none" autoCorrect={false} style={[styles.input, { color: colors.foreground, borderColor: colors.border, flex: 1 }]}/>
            <Pressable onPress={() => { setProviderId(id); void addCustom(id); }} style={[styles.add, { backgroundColor: colors.primary }]}><Feather name="plus" size={17} color={colors.primaryForeground}/></Pressable>
          </View>
          {active ? <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700', marginTop: 8 }}>Default: {selected?.modelId}</Text> : null}
        </View>;
      })}
      <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Model ID নিজে যোগ করা হয়; এই স্ক্রিন এখনো provider থেকে live model list fetch করে না। Free/Paid status নির্বাচন করার আগে provider-এর official pricing ও quota যাচাই করো।</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 27, fontWeight: '900' },
  card: { borderWidth: 1, borderRadius: 18, padding: 13 },
  row: { flexDirection: 'row', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '800' },
  modelRow: { borderBottomWidth: 1, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10, minWidth: 0 },
  add: { width: 43, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
