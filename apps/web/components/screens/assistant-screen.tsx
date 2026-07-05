"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";

import { loadAssistantThreads, type StoredAssistantThread } from "../../lib/assistant-thread-storage";
import { apiClient } from "../../lib/client";
import { formatRuntimeModeLabel } from "../../lib/presentation";
import { webRuntimeConfig } from "../../lib/runtime-config";
import { AdvisorChat } from "../advisor/advisor-chat";
import type { AdvisorUIMessage } from "../advisor/local-demo-transport";
import { ScreenHeader } from "../ui/screen-header";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";
import { StatusBadge } from "../ui/status-badge";

/**
 * The advisor screen (Task 5.9): streamed AI SDK 7 chat with tool-approval
 * cards routed through the review gate, sourced provenance chips, EU AI Act
 * Article 50 labeling (persistent badge + per-message marker), locally stored
 * conversation threads, and an honest disabled panel when the workspace's AI
 * posture turns the advisor off.
 */

type ActiveThread = { id: string; messages: AdvisorUIMessage[] };

function freshThread(): ActiveThread {
  return { id: `thread-${crypto.randomUUID()}`, messages: [] };
}

export function AssistantScreen() {
  const t = useTranslations("advisor");
  const [threads, setThreads] = useState<StoredAssistantThread[]>(() =>
    typeof window !== "undefined" ? loadAssistantThreads() : [],
  );
  const [activeThread, setActiveThread] = useState<ActiveThread>(freshThread);

  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });

  if (settingsQuery.isPending) {
    return <ScreenSkeleton />;
  }

  // Unset settings fall back to the contract default (advisor enabled).
  const advisorEnabled = settingsQuery.data?.aiPosture?.advisorEnabled ?? true;

  const header = (
    <ScreenHeader
      eyebrow={t("eyebrow")}
      title={t("title")}
      description={t("description")}
      aside={
        <div className="glass-panel-soft rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge testId="ai-assistant-label" status={t("article50.badge")} variant="info" />
            <SectionLabel>{formatRuntimeModeLabel(webRuntimeConfig.runtimeMode)}</SectionLabel>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("article50.statement")}</p>
        </div>
      }
    />
  );

  if (!advisorEnabled) {
    return (
      <div className="page-shell space-y-6">
        {header}
        <section className="glass-panel rounded-xl p-6 sm:p-7" data-testid="advisor-disabled-panel">
          <p className="text-eyebrow">{t("disabled.eyebrow")}</p>
          <h2 className="mt-3 text-2xl font-semibold text-foreground">{t("disabled.title")}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{t("disabled.message")}</p>
          <Link
            href="/settings/ai-posture"
            className="mt-4 inline-flex rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white"
          >
            {t("disabled.cta")}
          </Link>
        </section>
      </div>
    );
  }

  const threadList = (
    <ThreadList
      threads={threads}
      activeId={activeThread.id}
      onSelect={(thread) => setActiveThread({ id: thread.id, messages: thread.messages })}
      onNew={() => setActiveThread(freshThread())}
    />
  );

  return (
    <div className="page-shell space-y-6">
      {header}

      <details className="glass-panel rounded-xl p-4 lg:hidden">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">{t("threads.title")}</summary>
        <div className="mt-4 max-h-60 overflow-y-auto">{threadList}</div>
      </details>

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <section className="glass-panel hidden rounded-xl p-4 lg:block" data-testid="assistant-thread-list">
          <h2 className="text-sm font-semibold text-foreground">{t("threads.title")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("threads.subtitle")}</p>
          <div className="mt-4 max-h-[min(32rem,60vh)] overflow-y-auto">{threadList}</div>
        </section>

        <section className="glass-panel rounded-xl p-5" data-testid="assistant-panel">
          <AdvisorChat key={activeThread.id} thread={activeThread} onThreadsChange={setThreads} />
        </section>
      </div>
    </div>
  );
}

function ThreadList({
  threads,
  activeId,
  onSelect,
  onNew,
}: {
  threads: StoredAssistantThread[];
  activeId: string;
  onSelect: (thread: StoredAssistantThread) => void;
  onNew: () => void;
}) {
  const t = useTranslations("advisor.threads");

  return (
    <div className="space-y-3">
      <button
        type="button"
        data-testid="advisor-new-thread"
        onClick={onNew}
        className="w-full rounded-xl border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-surface-muted"
      >
        {t("new")}
      </button>
      {threads.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                data-testid="advisor-thread"
                aria-current={thread.id === activeId ? "true" : undefined}
                onClick={() => onSelect(thread)}
                className={`w-full rounded-xl px-3 py-3 text-left text-xs font-semibold text-foreground ${
                  thread.id === activeId ? "bg-primary-soft" : "glass-panel-soft hover:bg-surface-muted"
                }`}
              >
                <span className="line-clamp-2">{thread.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
