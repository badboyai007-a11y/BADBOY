import AsyncStorage from "@react-native-async-storage/async-storage";
import { validatePersonalWorkflow, type PersonalWorkflow } from "./workflowBuilder";

const WORKFLOWS_KEY = "badboy-personal-workflows-v1";

export async function loadPersonalWorkflows(): Promise<PersonalWorkflow[]> {
  const raw = await AsyncStorage.getItem(WORKFLOWS_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Saved workflow data is invalid.");
  return parsed.map((item) => validatePersonalWorkflow(item));
}

export async function savePersonalWorkflow(value: unknown): Promise<PersonalWorkflow[]> {
  const workflow = validatePersonalWorkflow(value);
  const current = await loadPersonalWorkflows();
  const next = current.some((item) => item.id === workflow.id)
    ? current.map((item) => item.id === workflow.id ? workflow : item)
    : [...current, workflow];
  await AsyncStorage.setItem(WORKFLOWS_KEY, JSON.stringify(next));
  return next;
}

export async function deletePersonalWorkflow(id: string): Promise<PersonalWorkflow[]> {
  const current = await loadPersonalWorkflows();
  const next = current.filter((item) => item.id !== id);
  await AsyncStorage.setItem(WORKFLOWS_KEY, JSON.stringify(next));
  return next;
}
