import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { SKILL_TOOL_ALLOWLIST, type SkillTool, type SkillDefinition } from "@/lib/assistant/skillRegistry";
import {
  deleteCustomSkill,
  getActiveCustomSkillId,
  loadCustomSkills,
  saveCustomSkill,
  setActiveCustomSkill,
} from "@/lib/assistant/skillStorage";

const TOOL_LABELS: Record<SkillTool, string> = {
  calculator: "Calculator",
  current_datetime: "Date & time",
  count_words: "Word count",
  web_research: "Web research",
};

export default function SkillsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [tools, setTools] = useState<SkillTool[]>(["calculator", "web_research"]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [nextSkills, nextActive] = await Promise.all([loadCustomSkills(), getActiveCustomSkillId()]);
    setSkills(nextSkills);
    setActiveSkillId(nextActive);
  };

  useEffect(() => {
    let active = true;
    void refresh().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Custom skills could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const toggleTool = (tool: SkillTool) => {
    setTools((current) => current.includes(tool)
      ? current.filter((item) => item !== tool)
      : [...current, tool]);
  };

  const createSkill = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const cleanName = name.trim();
      const cleanDescription = description.trim();
      const cleanInstructions = instructions.trim();
      if (!cleanName || !cleanDescription || !cleanInstructions) {
        throw new Error("Name, description, and instructions are required.");
      }
      const skillId = `custom-${Date.now().toString(36)}`;
      const next = await saveCustomSkill({
        id: skillId,
        name: cleanName,
        description: cleanDescription,
        instructions: cleanInstructions,
        tools,
      });
      setSkills(next);
      setName("");
      setDescription("");
      setInstructions("");
      setTools(["calculator", "web_research"]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Custom skill could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const activateSkill = async (id: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await setActiveCustomSkill(id);
      setActiveSkillId(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Skill activation failed.");
    } finally {
      setBusy(false);
    }
  };

  const removeSkill = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await deleteCustomSkill(id);
      setSkills(next);
      if (activeSkillId === id) setActiveSkillId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Skill could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 12) + 12, paddingBottom: Math.max(insets.bottom, 20) + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.eyebrow, { color: colors.primary }]}>BADBOY SKILLS</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>Custom Skills</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        নিজের কাজের নিয়ম ও নির্দেশনা দিয়ে Skill তৈরি করুন। Active Skill পরের AI chat-এ context হিসেবে যাবে।
      </Text>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Create a skill</Text>
        <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="Skill name" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
        <TextInput value={description} onChangeText={setDescription} maxLength={300} placeholder="What should this skill do?" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
        <TextInput value={instructions} onChangeText={setInstructions} maxLength={4000} multiline textAlignVertical="top" placeholder="Write the skill instructions (max 4,000 characters)" placeholderTextColor={colors.mutedForeground} style={[styles.input, styles.instructions, { color: colors.foreground, borderColor: colors.border }]} />
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>Allowed tool hints</Text>
        <View style={styles.toolWrap}>
          {SKILL_TOOL_ALLOWLIST.map((tool) => {
            const selected = tools.includes(tool);
            return (
              <Pressable key={tool} onPress={() => toggleTool(tool)} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.toolChip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.secondary : colors.card }]}>
                <Text style={[styles.meta, { color: selected ? colors.primary : colors.foreground }]}>{TOOL_LABELS[tool]}</Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable accessibilityRole="button" onPress={() => { void createSkill(); }} disabled={busy} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: busy ? 0.5 : 1 }]}>
          {busy ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="plus" size={16} color={colors.primaryForeground} />}
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>Save custom skill</Text>
        </Pressable>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Saved skills ({skills.length})</Text>
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        {!loading && skills.length === 0 ? <Text style={[styles.meta, { color: colors.mutedForeground }]}>এখনো কোনো Custom Skill তৈরি করা হয়নি।</Text> : null}
        {skills.map((skill) => (
          <View key={skill.id} style={[styles.skillRow, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.skillName, { color: colors.foreground }]}>{skill.name}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>{skill.description}</Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>Tools: {skill.tools.map((tool) => TOOL_LABELS[tool]).join(", ") || "None"}</Text>
            </View>
            <View style={{ gap: 8 }}>
              <Pressable accessibilityRole="button" onPress={() => { void activateSkill(activeSkillId === skill.id ? null : skill.id); }} disabled={busy} style={[styles.smallButton, { backgroundColor: activeSkillId === skill.id ? colors.secondary : colors.primary }]}>
                <Text style={{ color: activeSkillId === skill.id ? colors.foreground : colors.primaryForeground, fontWeight: "700", fontSize: 11 }}>{activeSkillId === skill.id ? "Active" : "Activate"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { void removeSkill(skill.id); }} disabled={busy} style={[styles.smallButton, { borderWidth: 1, borderColor: colors.border }]}>
                <Text style={{ color: colors.mutedForeground, fontWeight: "700", fontSize: 11 }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.notice, { backgroundColor: colors.secondary }]}>
        <Feather name="shield" size={16} color={colors.primary} />
        <Text style={[styles.meta, { color: colors.foreground, flex: 1 }]}>
          Skill instructions are untrusted guidance. They cannot add tools, override security rules, access secrets, or bypass owner approval.
        </Text>
      </View>
      {error ? <Text style={[styles.meta, { color: colors.destructive ?? colors.foreground }]}>{error}</Text> : null}
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
  input: { borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14 },
  instructions: { minHeight: 130, textAlignVertical: "top" },
  toolWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  toolChip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 8 },
  primaryButton: { minHeight: 44, borderRadius: 11, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  skillRow: { flexDirection: "row", gap: 10, alignItems: "center", paddingTop: 12, borderTopWidth: 1 },
  skillName: { fontSize: 14, fontWeight: "800" },
  smallButton: { minWidth: 68, minHeight: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  meta: { fontSize: 12, lineHeight: 18 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, padding: 12, marginTop: 14 },
});
