import AsyncStorage from "@react-native-async-storage/async-storage";
import { SkillRegistry, validateSkillDefinition, type SkillDefinition } from "./skillRegistry";

const SKILLS_KEY = "badboy-custom-skills-v1";

interface StoredSkillState {
  skills: SkillDefinition[];
  activeSkillId: string | null;
}

async function readState(): Promise<StoredSkillState> {
  const raw = await AsyncStorage.getItem(SKILLS_KEY);
  if (!raw) return { skills: [], activeSkillId: null };
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Saved custom skill data is invalid.");
  }
  const value = parsed as Record<string, unknown>;
  if (!Array.isArray(value.skills)) throw new Error("Saved custom skill list is invalid.");
  const skills = value.skills.map((item) => validateSkillDefinition(item));
  const requestedActive = typeof value.activeSkillId === "string" ? value.activeSkillId : null;
  const activeSkillId = requestedActive && skills.some((skill) => skill.id === requestedActive)
    ? requestedActive
    : null;
  return { skills, activeSkillId };
}

async function writeState(state: StoredSkillState): Promise<void> {
  await AsyncStorage.setItem(SKILLS_KEY, JSON.stringify(state));
}

export async function loadCustomSkills(): Promise<SkillDefinition[]> {
  const state = await readState();
  return state.skills.map((skill) => ({ ...skill, tools: [...skill.tools] }));
}

export async function getActiveCustomSkillId(): Promise<string | null> {
  return (await readState()).activeSkillId;
}

export async function saveCustomSkill(value: unknown): Promise<SkillDefinition[]> {
  const skill = validateSkillDefinition(value);
  const state = await readState();
  const skills = state.skills.some((item) => item.id === skill.id)
    ? state.skills.map((item) => item.id === skill.id ? skill : item)
    : [...state.skills, skill];
  await writeState({ ...state, skills });
  return skills.map((item) => ({ ...item, tools: [...item.tools] }));
}

export async function setActiveCustomSkill(id: string | null): Promise<void> {
  const state = await readState();
  if (id !== null && !state.skills.some((skill) => skill.id === id)) {
    throw new Error("Custom skill was not found.");
  }
  await writeState({ ...state, activeSkillId: id });
}

export async function deleteCustomSkill(id: string): Promise<SkillDefinition[]> {
  const state = await readState();
  const skills = state.skills.filter((skill) => skill.id !== id);
  await writeState({
    skills,
    activeSkillId: state.activeSkillId === id ? null : state.activeSkillId,
  });
  return skills;
}

/** Build one active skill as bounded, untrusted agent context; it never grants new tools. */
export async function getActiveCustomSkillContext(): Promise<string | null> {
  const state = await readState();
  if (!state.activeSkillId) return null;
  const registry = new SkillRegistry();
  for (const skill of state.skills) registry.register(skill);
  return registry.buildContext(state.activeSkillId);
}
