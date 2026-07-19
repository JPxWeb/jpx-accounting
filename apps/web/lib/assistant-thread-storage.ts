import type { AdvisorUIMessage } from "../components/advisor/local-demo-transport";

/**
 * Advisor thread storage v2 (Task 5.9): whole `UIMessage[]` conversations so a
 * reopened thread replays text, provenance, and tool-approval parts exactly as
 * streamed. v1 rows (`{question, answer}` from the retired one-shot assistant)
 * are read-migrated once into two-part conversations.
 *
 * `prependAssistantThread` writes to localStorage and RETURNS the merged array —
 * callers consume the return value instead of re-reading storage.
 */

const STORAGE_KEY = "jpx.accounting.assistantThreads.v2";
const LEGACY_STORAGE_KEY = "jpx.accounting.assistantThreads.v1";

/** Exported for the local-data registry pin (lib/local-data.ts + tests/unit/local-data-registry.test.ts). */
export const ASSISTANT_THREADS_STORAGE_KEY = STORAGE_KEY;
export const ASSISTANT_THREADS_LEGACY_STORAGE_KEY = LEGACY_STORAGE_KEY;
const MAX_THREADS = 30;
const MAX_TITLE_CHARS = 80;

export type StoredAssistantThread = {
  id: string;
  title: string;
  messages: AdvisorUIMessage[];
  savedAt: string;
};

type LegacyStoredThread = {
  id: string;
  question: string;
  answer?: string;
  savedAt?: string;
};

function isStoredThread(row: unknown): row is StoredAssistantThread {
  return (
    typeof row === "object" &&
    row !== null &&
    typeof (row as StoredAssistantThread).id === "string" &&
    typeof (row as StoredAssistantThread).title === "string" &&
    Array.isArray((row as StoredAssistantThread).messages)
  );
}

function safeParseV2(raw: string | null): StoredAssistantThread[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredThread);
  } catch {
    return [];
  }
}

/** v1 rows carried one Q/A pair — replay them as a two-message conversation. */
function migrateLegacyThreads(raw: string | null): StoredAssistantThread[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (row): row is LegacyStoredThread =>
          typeof row === "object" &&
          row !== null &&
          typeof (row as LegacyStoredThread).id === "string" &&
          typeof (row as LegacyStoredThread).question === "string",
      )
      .map((row) => ({
        id: row.id,
        title: truncateTitle(row.question),
        savedAt: row.savedAt ?? new Date().toISOString(),
        messages: [
          { id: `${row.id}-q`, role: "user" as const, parts: [{ type: "text" as const, text: row.question }] },
          ...(typeof row.answer === "string" && row.answer.length > 0
            ? [{ id: `${row.id}-a`, role: "assistant" as const, parts: [{ type: "text" as const, text: row.answer }] }]
            : []),
        ],
      }))
      .slice(0, MAX_THREADS);
  } catch {
    return [];
  }
}

function truncateTitle(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TITLE_CHARS ? `${flat.slice(0, MAX_TITLE_CHARS - 1)}…` : flat;
}

/** Derive a list title from the first user text part. */
export function deriveThreadTitle(messages: AdvisorUIMessage[], fallback: string): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = message.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join(" ")
      .trim();
    if (text) return truncateTitle(text);
  }
  return fallback;
}

export function loadAssistantThreads(): StoredAssistantThread[] {
  if (typeof window === "undefined") return [];
  const rawV2 = window.localStorage.getItem(STORAGE_KEY);
  if (rawV2 !== null) return safeParseV2(rawV2);

  // One-time read-migration: no v2 key yet → lift v1 threads into v2. The v1
  // key is left in place (harmless; migration never runs again once v2 exists).
  const migrated = migrateLegacyThreads(window.localStorage.getItem(LEGACY_STORAGE_KEY));
  if (migrated.length > 0) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  }
  return migrated;
}

export function prependAssistantThread(thread: {
  id: string;
  title: string;
  messages: AdvisorUIMessage[];
}): StoredAssistantThread[] {
  const next: StoredAssistantThread = { ...thread, savedAt: new Date().toISOString() };
  if (typeof window === "undefined") return [next];
  const prev = loadAssistantThreads().filter((entry) => entry.id !== next.id);
  const merged = [next, ...prev].slice(0, MAX_THREADS);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}
