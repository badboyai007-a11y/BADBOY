import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { PROVIDERS, getConnectedProviderIds, removeProviderKey, saveProviderKey, type ProviderId } from '@/lib/assistant/providerManager';

export default function ProviderManagerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [connected, setConnected] = useState<ProviderId[]>([]);
  const [expanded, setExpanded] = useState<ProviderId | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<ProviderId, string>>>({});
  const [busy, setBusy] = useState<ProviderId | null>(null);

  const refresh = useCallback(async () => setConnected(await getConnectedProviderIds()), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async (id: ProviderId) => {
    const key = drafts[id]?.trim();
    if (!key) { Alert.alert('API Key প্রয়োজন', 'Provider-এর API Key লিখুন।'); return; }
    setBusy(id);
    try {
      await saveProviderKey(id, key);
      setDrafts((current) => ({ ...current, [id]: '' }));
      await refresh();
      Alert.alert('সংরক্ষিত', 'API Key Android Secure Storage-এ রাখা হয়েছে।');
    } catch (error) {
      Alert.alert('সংরক্ষণ ব্যর্থ', error instanceof Error ? error.message : 'API Key সংরক্ষণ করা যায়নি।');
    } finally { setBusy(null); }
  };

  const disconnect = (id: ProviderId) => Alert.alert('Provider বিচ্ছিন্ন করবেন?', 'এই Provider-এর সংরক্ষিত API Key মুছে যাবে।', [
    { text: 'বাতিল', style: 'cancel' },
    { text: 'বিচ্ছিন্ন করুন', style: 'destructive', onPress: async () => { await removeProviderKey(id); await refresh(); } },
  ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 18, paddingTop: Math.max(insets.top, 12) + 12, paddingBottom: 36, gap: 12 }}>
      <Pressable onPress={() => router.back()} style={styles.back}><Feather name="arrow-left" size={19} color={colors.foreground}/><Text style={{ color: colors.foreground, fontWeight: '700' }}>Settings</Text></Pressable>
      <Text style={[styles.title, { color: colors.foreground }]}>Model Provider</Text>
      <Text style={{ color: colors.mutedForeground, lineHeight: 20 }}>একাধিক AI provider সংযুক্ত করো। API Key এই Android ডিভাইসের Secure Storage-এ রাখা হবে।</Text>
      {PROVIDERS.map((provider) => {
        const active = connected.includes(provider.id);
        const open = expanded === provider.id;
        return (
          <View key={provider.id} style={[styles.card, { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border }]}>
            <Pressable onPress={() => setExpanded(open ? null : provider.id)} style={styles.row}>
              <View style={[styles.icon, { backgroundColor: colors.secondary }]}><Feather name="cpu" size={19} color={colors.primary}/></View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.name, { color: colors.foreground }]}>{provider.name}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{provider.description}</Text>
              </View>
              {active ? <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 11 }}>CONNECTED</Text> : null}
              <Feather name={open ? 'chevron-up' : 'chevron-right'} size={19} color={colors.mutedForeground}/>
            </Pressable>
            {open ? (
              <View style={{ gap: 9, paddingTop: 12 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>API Base: {provider.baseUrl}</Text>
                <TextInput value={drafts[provider.id] ?? ''} onChangeText={(value) => setDrafts((current) => ({ ...current, [provider.id]: value }))} placeholder={active ? 'নতুন API Key দিলে replace হবে' : 'API Key লিখুন'} placeholderTextColor={colors.mutedForeground} secureTextEntry autoCapitalize="none" autoCorrect={false} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}/>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => void save(provider.id)} disabled={busy === provider.id} style={[styles.primary, { backgroundColor: colors.primary, flex: 1 }]}>
                    {busy === provider.id ? <ActivityIndicator color={colors.primaryForeground}/> : <Feather name="lock" size={15} color={colors.primaryForeground}/>}
                    <Text style={{ color: colors.primaryForeground, fontWeight: '800' }}>Save Key</Text>
                  </Pressable>
                  {active ? <Pressable onPress={() => disconnect(provider.id)} style={[styles.secondary, { borderColor: colors.border }]}><Text style={{ color: colors.destructive, fontWeight: '700' }}>Disconnect</Text></Pressable> : null}
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>সংযোগ পরীক্ষা ও Live Model Discovery পরবর্তী ধাপে যুক্ত হবে। Free quota provider ও account অনুযায়ী বদলাতে পারে।</Text>
              </View>
            ) : null}
          </View>
        );
      })}
      <Pressable onPress={() => router.push('/(tabs)/models' as never)} style={[styles.card, styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.icon, { backgroundColor: colors.secondary }]}><Feather name="sliders" size={19} color={colors.primary}/></View>
        <View style={{ flex: 1 }}><Text style={[styles.name, { color: colors.foreground }]}>Default Models</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Default ও custom model নির্বাচন</Text></View>
        <Feather name="chevron-right" size={19} color={colors.mutedForeground}/>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  title: { fontSize: 27, fontWeight: '900' },
  card: { borderWidth: 1, borderRadius: 18, padding: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '800' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
  primary: { minHeight: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  secondary: { minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
});
