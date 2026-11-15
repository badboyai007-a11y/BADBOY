import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAssistant } from "@/context/AssistantContext";
import { useColors } from "@/hooks/useColors";
import { getCalendarEvents, getDiscordMessages, getHomeAssistantStates, getIntegrationStatus, getSlackMessages, searchWebResearch, streamReply, type AssistantIntegrationStatus, type CalendarEvent, type DiscordMessage, type HomeAssistantState, type SlackMessage } from "@/lib/assistant/api";
import { executePersonalWorkflow, type WorkflowAdapters } from "@/lib/assistant/workflowEngine";
import { workflowNeedsOwnerApproval, type PersonalWorkflow, type WorkflowAction, type WorkflowStep } from "@/lib/assistant/workflowBuilder";
import { resolveOfflineCapability } from "@/lib/assistant/offlineCapability";
import { deletePersonalWorkflow, loadPersonalWorkflows, savePersonalWorkflow } from "@/lib/assistant/workflowStorage";
import { openCalendarDraft, scheduleLocalReminder } from "@/lib/assistant/deviceControl";
import { sendTelegramMessage } from "@/lib/assistant/telegram";

export default function WorkflowsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { settings } = useAssistant();
  const offlineCapability = resolveOfflineCapability({ platform: Platform.OS, modelInstalled: false, runtimeReady: false });
  const [workflows, setWorkflows] = useState<PersonalWorkflow[]>([]);
  const [name, setName] = useState("");
  const [draftSteps, setDraftSteps] = useState<WorkflowStep[]>([]);
  const [stepAction, setStepAction] = useState<WorkflowAction>("research.search");
  const [stepInput, setStepInput] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [calendarStart, setCalendarStart] = useState("");
  const [calendarEnd, setCalendarEnd] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string>("");
  const [integrationStatus, setIntegrationStatus] = useState<AssistantIntegrationStatus | null>(null);
  const [discordChannel, setDiscordChannel] = useState("");
  const [discordMessages, setDiscordMessages] = useState<DiscordMessage[]>([]);
  const [slackChannel, setSlackChannel] = useState("");
  const [slackMessages, setSlackMessages] = useState<SlackMessage[]>([]);
  const [slackBusy, setSlackBusy] = useState(false);
  const [homeAssistantStates, setHomeAssistantStates] = useState<HomeAssistantState[]>([]);
  const [homeAssistantBusy, setHomeAssistantBusy] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarBusy, setCalendarBusy] = useState(false);

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

  useEffect(() => {
    let active = true;
    void getIntegrationStatus().then((status) => {
      if (active) setIntegrationStatus(status);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Integration status could not be loaded.");
    });
    return () => { active = false; };
  }, []);

  const loadCalendarEvents = async () => {
    setCalendarBusy(true);
    setError(null);
    try {
      setCalendarEvents(await getCalendarEvents());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Calendar events could not be loaded.");
    } finally {
      setCalendarBusy(false);
    }
  };

  const loadHomeAssistantStates = async () => {
    setHomeAssistantBusy(true);
    setError(null);
    try {
      setHomeAssistantStates(await getHomeAssistantStates());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Home Assistant states could not be loaded.");
    } finally {
      setHomeAssistantBusy(false);
    }
  };

  const loadSlackHistory = async () => {
    setSlackBusy(true);
    setError(null);
    try {
      setSlackMessages(await getSlackMessages(slackChannel));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Slack history could not be loaded.");
    } finally {
      setSlackBusy(false);
    }
  };

  const loadDiscordHistory = async () => {
    setDiscordBusy(true);
    setError(null);
    try {
      const messages = await getDiscordMessages(discordChannel);
      setDiscordMessages(messages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Discord history could not be loaded.");
    } finally {
      setDiscordBusy(false);
    }
  };

  const addDraftStep = () => {
    const value = stepInput.trim();
    if (!value || draftSteps.length >= 8) return;
    const id = `step-${Date.now().toString(36)}-${draftSteps.length}`;
    let input: Record<string, string>;
    if (stepAction === "assistant.ask") input = { prompt: value };
    else if (stepAction === "research.search") input = { query: value };
    else if (stepAction === "reminder.create") {
      if (!Number.isFinite(Date.parse(reminderAt))) {
        setError("Reminder-এর জন্য সঠিক date/time দিন।");
        return;
      }
      input = { title: value, at: new Date(reminderAt).toISOString() };
    } else if (stepAction === "calendar.create") {
      const start = Date.parse(calendarStart);
      const end = Date.parse(calendarEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        setError("Calendar event-এর জন্য সঠিক start ও end date/time দিন।");
        return;
      }
      input = { title: value, start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    } else input = { text: value };
    setDraftSteps((current) => [...current, { id, action: stepAction, input }]);
    setStepInput("");
    setReminderAt("");
    setCalendarStart("");
    setCalendarEnd("");
    setError(null);
  };

  const createPersonalWorkflow = async () => {
    const cleanName = name.trim();
    if (!cleanName || draftSteps.length < 1 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const next = await savePersonalWorkflow({
        id: `workflow-${Date.now().toString(36)}`,
        name: cleanName,
        enabled: true,
        trigger: "manual",
        steps: draftSteps,
      });
      setWorkflows(next);
      setName("");
      setDraftSteps([]);
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
      "calendar.create": async (input) => {
        const start = new Date(input.start ?? "");
        const end = new Date(input.end ?? "");
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw new Error("Calendar event date is invalid.");
        const opened = await openCalendarDraft({ title: input.title ?? "Badboy event", start, end });
        return { calendarDraftOpened: opened, userMustSaveInCalendar: true };
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
        .filter((step) => step.action === "reminder.create" || step.action === "calendar.create" || step.action === "telegram.send")
        .map((step) => step.id);
      Alert.alert(
        "Owner approval required",
        "এই workflow-তে reminder, calendar draft বা message-এর মতো side effect আছে। আপনি কি এই নির্দিষ্ট ধাপগুলো চালাতে অনুমতি দিচ্ছেন?",
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
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Integration Status</Text>
        {integrationStatus ? (
          <>
            {([
              ["Web Research", integrationStatus.research.configured ? "Configured" : "Not configured", integrationStatus.research.configured],
              ["Home Assistant", integrationStatus.homeAssistant.configured ? "Configured" : "Not configured", integrationStatus.homeAssistant.configured],
              ["Slack", integrationStatus.slack.configured ? "Configured" : "Not configured", integrationStatus.slack.configured],
              ["Discord", integrationStatus.discord.configured ? "Configured" : "Not configured", integrationStatus.discord.configured],
              ["Google Calendar", integrationStatus.googleCalendar.configured ? "Configured" : "Not configured", integrationStatus.googleCalendar.configured],
              ["Telegram (mobile)", "Managed on device", true],
              ["Offline AI", offlineCapability.mode === "cached_assistance" ? "Cached assistance only" : "Unavailable", false],
            ] as const).map(([label, status, ready]) => (
              <View key={label} style={styles.statusRow}>
                <Text style={[styles.meta, { color: colors.foreground }]}>{label}</Text>
                <Text style={[styles.meta, { color: ready ? colors.primary : colors.mutedForeground }]}>{status}</Text>
              </View>
            ))}
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              Provider secrets stay server-side. Smart-home and Slack actions are read-only until secure owner approval is enabled.
            </Text>
          </>
        ) : (
          <Text style={[styles.meta, { color: colors.mutedForeground }]}>Provider readiness is loading or the backend is unavailable.</Text>
        )}
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Home Assistant devices (read-only)</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => { void loadHomeAssistantStates(); }}
          disabled={homeAssistantBusy || !integrationStatus?.homeAssistant.configured}
          style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: homeAssistantBusy || !integrationStatus?.homeAssistant.configured ? 0.5 : 1 }]}
        >
          <Feather name="home" size={16} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>{homeAssistantBusy ? "Loading…" : "Load device states"}</Text>
        </Pressable>
        {homeAssistantStates.map((entity) => (
          <View key={entity.entityId} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={[styles.meta, { color: colors.primary }]}>{entity.friendlyName || entity.entityId}</Text>
            <Text style={[styles.meta, { color: colors.foreground }]}>{entity.entityId} · {entity.state}</Text>
          </View>
        ))}
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          Read-only device state. Configure HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN as Worker secrets. Device control remains disabled until owner approval is implemented and tested.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Slack channel history (read-only)</Text>
        <TextInput
          value={slackChannel}
          onChangeText={setSlackChannel}
          maxLength={32}
          autoCapitalize="characters"
          placeholder="Slack channel ID (e.g. C123456)"
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="Slack channel ID"
          style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => { void loadSlackHistory(); }}
          disabled={!/^[A-Z0-9]{6,32}$/.test(slackChannel.trim()) || slackBusy || !integrationStatus?.slack.configured}
          style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: !/^[A-Z0-9]{6,32}$/.test(slackChannel.trim()) || slackBusy || !integrationStatus?.slack.configured ? 0.5 : 1 }]}
        >
          <Feather name="message-square" size={16} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>{slackBusy ? "Loading…" : "Load Slack messages"}</Text>
        </Pressable>
        {slackMessages.map((message, index) => (
          <View key={`${message.timestamp}-${message.user}-${index}`} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={[styles.meta, { color: colors.primary }]}>{message.user} · {message.timestamp}</Text>
            <Text style={[styles.meta, { color: colors.foreground }]}>{message.text || "(empty message)"}</Text>
          </View>
        ))}
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          Read-only history. Configure SLACK_BOT_TOKEN as a Worker secret and grant the bot channels:history or groups:history. Sending is disabled.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Google Calendar (read-only)</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => { void loadCalendarEvents(); }}
          disabled={calendarBusy || !integrationStatus?.googleCalendar.configured}
          style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: calendarBusy || !integrationStatus?.googleCalendar.configured ? 0.5 : 1 }]}
        >
          <Feather name="calendar" size={16} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>{calendarBusy ? "Loading…" : "Load upcoming events"}</Text>
        </Pressable>
        {calendarEvents.map((event) => (
          <View key={event.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={[styles.meta, { color: colors.primary }]}>{event.summary}</Text>
            <Text style={[styles.meta, { color: colors.foreground }]}>{event.start || "Date unavailable"}{event.location ? ` · ${event.location}` : ""}</Text>
          </View>
        ))}
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          Configure GOOGLE_CALENDAR_ACCESS_TOKEN as a Worker secret with read-only calendar scope. Event creation and modification remain disabled.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Discord channel history (read-only)</Text>
        <TextInput
          value={discordChannel}
          onChangeText={setDiscordChannel}
          maxLength={20}
          keyboardType="number-pad"
          placeholder="Discord channel ID"
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="Discord channel ID"
          style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => { void loadDiscordHistory(); }}
          disabled={!/^\d{17,20}$/.test(discordChannel.trim()) || discordBusy}
          style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: !/^\d{17,20}$/.test(discordChannel.trim()) || discordBusy ? 0.5 : 1 }]}
        >
          <Feather name="message-circle" size={16} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>{discordBusy ? "Loading…" : "Load Discord messages"}</Text>
        </Pressable>
        {discordMessages.map((message) => (
          <View key={message.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={[styles.meta, { color: colors.primary }]}>{message.author} · {new Date(message.timestamp).toLocaleString()}</Text>
            <Text style={[styles.meta, { color: colors.foreground }]}>{message.content || "(empty message)"}</Text>
          </View>
        ))}
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          Read-only access. Configure DISCORD_BOT_TOKEN as a Worker secret and grant the bot View Channel and Read Message History permissions. Sending is disabled.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Personal Workflow Builder</Text>
        <TextInput value={name} onChangeText={setName} maxLength={80} placeholder="Workflow-এর নাম" placeholderTextColor={colors.mutedForeground} accessibilityLabel="Workflow name" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>একটি workflow-তে সর্বোচ্চ ৮টি step যোগ করুন। এখন manual run সমর্থিত।</Text>
        <View style={styles.actionWrap}>
          {([
            ["research.search", "Web research"],
            ["assistant.ask", "Ask AI"],
            ["reminder.create", "Reminder"],
            ["calendar.create", "Calendar draft"],
            ["telegram.send", "Telegram send"],
          ] as Array<[WorkflowAction, string]>).map(([action, label]) => (
            <Pressable key={action} accessibilityRole="button" accessibilityState={{ selected: stepAction === action }} onPress={() => setStepAction(action)} style={[styles.actionChip, { borderColor: stepAction === action ? colors.primary : colors.border, backgroundColor: stepAction === action ? colors.secondary : colors.card }]}>
              <Text style={[styles.meta, { color: stepAction === action ? colors.primary : colors.foreground }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          value={stepInput}
          onChangeText={setStepInput}
          maxLength={stepAction === "research.search" ? 500 : 1000}
          multiline={stepAction === "assistant.ask" || stepAction === "telegram.send"}
          placeholder={stepAction === "research.search" ? "কী বিষয়ে research করবে?" : stepAction === "assistant.ask" ? "AI-কে কী করতে বলবে?" : stepAction === "reminder.create" ? "Reminder title" : stepAction === "calendar.create" ? "Calendar event title" : "Telegram message"}
          placeholderTextColor={colors.mutedForeground}
          accessibilityLabel="Workflow step input"
          style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
        />
        {stepAction === "reminder.create" ? (
          <TextInput value={reminderAt} onChangeText={setReminderAt} placeholder="Reminder date/time (ISO or local date)" placeholderTextColor={colors.mutedForeground} accessibilityLabel="Reminder date and time" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
        ) : null}
        {stepAction === "calendar.create" ? (
          <>
            <TextInput value={calendarStart} onChangeText={setCalendarStart} placeholder="Event start (ISO or local date/time)" placeholderTextColor={colors.mutedForeground} accessibilityLabel="Calendar event start" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
            <TextInput value={calendarEnd} onChangeText={setCalendarEnd} placeholder="Event end (ISO or local date/time)" placeholderTextColor={colors.mutedForeground} accessibilityLabel="Calendar event end" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />
          </>
        ) : null}
        <Pressable accessibilityRole="button" onPress={addDraftStep} disabled={!stepInput.trim() || draftSteps.length >= 8 || (stepAction === "reminder.create" && !reminderAt.trim()) || (stepAction === "calendar.create" && (!calendarStart.trim() || !calendarEnd.trim()))} style={[styles.secondaryButton, { borderColor: colors.border, opacity: !stepInput.trim() || draftSteps.length >= 8 || (stepAction === "reminder.create" && !reminderAt.trim()) ? 0.5 : 1 }]}>
          <Feather name="plus-circle" size={16} color={colors.primary} />
          <Text style={{ color: colors.foreground, fontWeight: "700" }}>Add step ({draftSteps.length}/8)</Text>
        </Pressable>
        {draftSteps.map((step, index) => (
          <View key={step.id} style={[styles.draftStep, { borderTopColor: colors.border }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.meta, { color: colors.primary }]}>Step {index + 1} · {step.action}</Text>
              <Text style={[styles.meta, { color: colors.foreground }]}>{Object.values(step.input).join(" · ")}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove step ${index + 1}`} onPress={() => setDraftSteps((current) => current.filter((item) => item.id !== step.id))}>
              <Feather name="x-circle" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        ))}
        <Pressable accessibilityRole="button" onPress={() => { void createPersonalWorkflow(); }} disabled={!name.trim() || draftSteps.length < 1 || loading} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: !name.trim() || draftSteps.length < 1 || loading ? 0.5 : 1 }]}>
          <Feather name="save" size={16} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>Save workflow ({draftSteps.length} steps)</Text>
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
  actionWrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  actionChip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 8 },
  secondaryButton: { minHeight: 40, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  draftStep: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 9, borderTopWidth: 1 },
  statusRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  workflowName: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 12, lineHeight: 18 },
  result: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 18, gap: 8 },
  resultText: { fontSize: 12, lineHeight: 18 },
});
