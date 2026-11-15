import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { BUILTIN_AGENT_PLUGINS, type AgentPluginId } from "@/lib/assistant/pluginCatalog";
import { loadEnabledPluginIds, setAgentPluginEnabled } from "@/lib/assistant/pluginStorage";

export default function PluginsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState<AgentPluginId[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<AgentPluginId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadEnabledPluginIds().then((ids) => {
      if (active) setEnabled(ids);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Plugin settings could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const toggle = async (id: AgentPluginId, value: boolean) => {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      setEnabled(await setAgentPluginEnabled(id, value));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plugin setting could not be saved.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 12) + 12, paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
    >
      <Text style={[styles.eyebrow, { color: colors.primary }]}>BADBOY ECOSYSTEM</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Plugin Manager</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Agent-এর জন্য কোন built-in integration ব্যবহার করা যাবে তা নিয়ন্ত্রণ করুন। পরিবর্তনগুলো এই ডিভাইসে সংরক্ষিত হবে।
      </Text>
      <View style={[styles.notice, { backgroundColor: colors.secondary }]}>
        <Feather name="shield" size={17} color={colors.primary} />
        <Text style={[styles.meta, { color: colors.foreground, flex: 1 }]}>
          এখানে শুধু trusted read-only adapters আছে। কোনো plugin arbitrary code চালাতে পারে না; messaging send ও smart-home control owner approval ছাড়া চালু হবে না।
        </Text>
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Available plugins</Text>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {BUILTIN_AGENT_PLUGINS.map((plugin) => {
          const isEnabled = enabled.includes(plugin.id);
          return (
            <View key={plugin.id} style={[styles.pluginRow, { borderTopColor: colors.border }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={[styles.pluginName, { color: colors.foreground }]}>{plugin.name}</Text>
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>{plugin.description}</Text>
                <Text style={[styles.status, { color: isEnabled ? colors.primary : colors.mutedForeground }]}>{isEnabled ? "Enabled for Agent" : "Disabled"}</Text>
              </View>
              <Switch
                value={isEnabled}
                onValueChange={(value) => { void toggle(plugin.id, value); }}
                disabled={loading || busyId !== null}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.primaryForeground}
                accessibilityLabel={`Enable ${plugin.name}`}
              />
            </View>
          );
        })}
      </View>
      {error ? <Text style={[styles.meta, { color: colors.primary }]}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16 },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 0.9 },
  title: { fontSize: 26, fontWeight: "800", marginTop: 4 },
  subtitle: { fontSize: 13, lineHeight: 20, marginTop: 6, marginBottom: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10, marginTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  pluginRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 12, borderTopWidth: 1 },
  pluginName: { fontSize: 14, fontWeight: "800" },
  status: { fontSize: 11, fontWeight: "700" },
  meta: { fontSize: 12, lineHeight: 18 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, padding: 12, marginTop: 14 },
});
