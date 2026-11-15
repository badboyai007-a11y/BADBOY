import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAssistant } from "@/context/AssistantContext";
import { useColors } from "@/hooks/useColors";
import { searchWebResearch, streamReply } from "@/lib/assistant/api";
import { executePersonalWorkflow, type WorkflowAdapters } from "@/lib/assistant/workflowEngine";
import { workflowNeedsOwnerApproval, type PersonalWorkflow } from "@/lib/assistant/workflowBuilder";
import { deletePersonalWorkflow, loadPersonalWorkflows, savePersonalWorkflow } from "@/lib/assistant/workflowStorage";
import { scheduleLocalReminder } from "@/lib/assistant/deviceControl";
import { sendTelegramMessage } from "@/lib/assistant/telegram";

export default function WorkflowsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useAssistant();
  const [workflows, setWorkflows] = useState<PersonalWorkflow[]>([]);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string>("");

  useEffect(() => {
    let active = true;
    void loadPersonalWorkflows().then((items) => {
      if (active) setWorkflows(items);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Workflow data could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const createResearchWorkflow = async () => {
    const cleanName = name.trim();
    const cleanQuery = query.trim();
    if (!cleanName || !cleanQuery || loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await savePersonalWorkflow({
        id: `research-${Date.now().toString(36)}`,
        name: cleanName,
        enabled: true,
        trigger: "manual",
        steps: [{ id: "research", action: "research.search", input: { query: cleanQuery } }],
      });
      setWorkflows(next);
      setName("");
      setQuery("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workflow could not be saved.");
    } finally {
      setLoading(false);
    }
  };

  const runWorkflow = async (workflow: PersonalWorkflow, approvedStepIds: string[] = []) => {
    setBusyId(workflow.id);
    setError(null);
    setLastResult("");
    const adapters: WorkflowAdapters = {
      "assistant.ask": async (input) => {
        let answer = "";
        await streamReply(input.prompt ?? "", settings, (chunk) => { answer += chunk; });
        return { answer };
      },
      "research.search": async (input) => searchWebResearch(input.query ?? ""),
      "reminder.create": async (input) => {
        const at = new Date(input.at ?? "");
        if (!Number.isFinite(at.getTime())) throw new Error("Reminder date is invalid.");
        return scheduleLocalReminder({ title: input.title ?? "Badboy reminder", body: input.body, at });
      },
      "telegram.send": async (input) => {
        await sendTelegramMessage(input.text ?? "");
        return { sent: true };
      },
    };
    try {
      const result = await executePersonalWorkflow(workflow, adapters, { approvedStepIds });
      setLastResult(JSON.stringify(result, null, 2));
      if (result.status === "failed" || result.status === "approval_required") setError(result.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workflow execution failed.");
    } finally {
      setBusyId(null);
    }
  };

  const confirmRun = (workflow: PersonalWorkflow) => {
    if (workflowNeedsOwnerApproval(workflow)) {
      const sideEffectIds = workflow.steps
        .filter((step) => step.action === "reminder.create" || step.action === "telegram.send")
        .map((step) => step.id);
      Alert.alert(
        "Owner approval required",
        "এই workflow-তে reminder বা message পাঠানোর মতো side effect আছে। আপনি কি এই নির্দিষ্ট ধাপগুলো চালাতে অনুমতি দিচ্ছেন?",
        [
          { text: "বাতিল", style: "cancel" },
          { text: "অনুমতি দিয়ে চালান", onPress: () => { void runWorkflow(workflow, sideEffectIds); } },
        ],
      );
      return;
    }
    void runWorkflow(workflow);
  };

  const removeWorkflow = (workflow: PersonalWorkflow) => {
    Alert.alert("Workflow মুছবেন?", `“${workflow.name}” মুছে ফেলা হবে।`, [
      { text: "বাতিল", style: "cancel" },
      { text: "মুছুন", style: "destructive", onPress: () => {
        void deletePersonalWorkflow(workflow.id).then(setWorkflows).catch((cause) => {
          setError(cause instanceof Error ? cause.message : "Workflow could not be deleted.");
        });
      } },
    ]);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 12) + 14, paddingBottom: Math.max(insets.bottom, 20) + 90 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.eyebrow, { color: colors.primary }]}>PERSONAL AUTOMATION</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Workflow Builder</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        আপনার নিজের ছোট workflow তৈরি করুন। এখন manual trigger চালু; scheduled workflow ও background execution আলাদা runtime verification না হওয়া পর্যন্ত বন্ধ।
      </Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>নতুন Web Research workflow</Text>
        <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="Workflow-এর নাম" placeholderTextColor={colors.mutedForeground} accessibilityLabel="Workflow name" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
        <TextInput value={query} onChangeText={setQuery} maxLength={500} placeholder="কী বিষয়ে research করবে?" placeholderTextColor={colors.mutedForeground} accessibilityLabel="Research query" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
        <Pressable accessibilityRole="button" onPress={() => { void createResearchWorkflow(); }} disabled={!name.trim() || !query.trim() || loading} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: !name.trim() || !query.trim() || loading ? 0.5 : 1 }]}>
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>Workflow সংরক্ষণ</Text>
        </Pressable>
      </View>
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? <Text style={{ color: colors.destructive, marginVertical: 10 }}>{error}</Text> : null}
      <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 18 }]}>আপনার Workflows ({workflows.length})</Text>
      {workflows.map((workflow) => (
        <View key={workflow.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.workflowName, { color: colors.foreground }]}>{workflow.name}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{workflow.trigger} · {workflow.steps.length} step(s)</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`${workflow.name} delete`} onPress={() => removeWorkflow(workflow)}>
              <Feather name="trash-2" size={17} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>{workflow.steps.map((step) => step.action).join(" → ")}</Text>
          <Pressable accessibilityRole="button" disabled={busyId !== null || !workflow.enabled} onPress={() => confirmRun(workflow)} style={[styles.primaryButton, { backgroundColor: colors.secondary, opacity: busyId !== null || !workflow.enabled ? 0.5 : 1 }]}>
            {busyId === workflow.id ? <ActivityIndicator color={colors.primary} /> : <Feather name="play" size={15} color={colors.primary} />}
            <Text style={{ color: colors.foreground, fontWeight: "700" }}>{busyId === workflow.id ? "চলছে…" : "Run manually"}</Text>
          </Pressable>
        </View>
      ))}
      {!loading && workflows.length === 0 ? <Text style={[styles.meta, { color: colors.mutedForeground, marginTop: 10 }]}>এখনো কোনো workflow তৈরি হয়নি। উপরের form দিয়ে শুরু করুন।</Text> : null}
      {lastResult ? (
        <View style={[styles.result, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>সর্বশেষ Run Result</Text>
          <Text selectable style={[styles.resultText, { color: colors.mutedForeground }]}>{lastResult}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16 },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  title: { fontSize: 26, fontWeight: "800", marginTop: 4 },
  subtitle: { fontSize: 13, lineHeight: 20, marginTop: 6, marginBottom: 16 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10, marginTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  input: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  primaryButton: { minHeight: 42, borderRadius: 11, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  workflowName: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 12, lineHeight: 18 },
  result: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 18, gap: 8 },
  resultText: { fontSize: 12, lineHeight: 18 },
});
