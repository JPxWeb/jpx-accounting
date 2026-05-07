import type { AssistantSession, Citation } from "@jpx-accounting/contracts";

const STORAGE_KEY = "jpx.accounting.assistantThreads.v1";
const MAX_THREADS = 30;

export type StoredAssistantThread = {
  id: string;
  question: string;
  answer: string;
  status: AssistantSession["status"];
  citations: Citation[];
  savedAt: string;
};

function safeParse(raw: string | null): StoredAssistantThread[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is StoredAssistantThread =>
        typeof row === "object" &&
        row !== null &&
        "id" in row &&
        typeof (row as StoredAssistantThread).id === "string" &&
        typeof (row as StoredAssistantThread).question === "string",
    );
  } catch {
    return [];
  }
}

export function loadAssistantThreads(): StoredAssistantThread[] {
  if (typeof window === "undefined") return [];
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function prependAssistantThread(session: AssistantSession): StoredAssistantThread[] {
  const next: StoredAssistantThread = {
    id: session.id,
    question: session.question,
    answer: session.answer,
    status: session.status,
    citations: session.citations,
    savedAt: new Date().toISOString(),
  };
  if (typeof window === "undefined") return [next];
  const prev = safeParse(window.localStorage.getItem(STORAGE_KEY)).filter((t) => t.id !== next.id);
  const merged = [next, ...prev].slice(0, MAX_THREADS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}
