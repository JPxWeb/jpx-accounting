"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { apiClient } from "../../lib/client";
import { getErrorMessage } from "../../lib/request-errors";
import { ScreenHeader } from "../ui/screen-header";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";
import { UnavailableState } from "../ui/unavailable-state";

export function AssistantScreen() {
  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });
  const { data } = workspaceQuery;

  if (workspaceQuery.error && !data) {
    return (
      <UnavailableState
        testId="assistant-unavailable"
        title="Advisor history unavailable"
        message={getErrorMessage(
          workspaceQuery.error,
          "The advisor history could not be loaded. Check the runtime configuration and API availability.",
        )}
      />
    );
  }

  if (!data) {
    return <ScreenSkeleton />;
  }

  const sessions = data.assistantExamples ?? [];

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Advisor history"
        title="Past advisory sessions and their citations."
        description="Detailed Q&A with the advisor moves to the global Cmd-K palette in Phase 6. This page is the read-only history of prior sessions."
        aside={
          <Link
            href="/today?advisor=open"
            data-testid="open-advisor-button"
            className="inline-flex items-center rounded-xl bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-white"
          >
            Open Advisor (⌘K)
          </Link>
        }
      />

      <section className="glass-panel rounded-3xl p-5" data-testid="assistant-panel">
        <SectionLabel>Session history</SectionLabel>
        <div className="mt-6 space-y-4">
          {sessions.map((item) => (
            <article key={item.id} data-testid="assistant-response" className="glass-panel-soft rounded-2xl p-4">
              <SectionLabel>{item.status}</SectionLabel>
              <h2 className="mt-2 text-lg font-semibold">{item.question}</h2>
              <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{item.answer}</p>
              <div className="mt-4 space-y-2">
                {item.citations.map((citation) => (
                  <div key={citation.id} className="glass-panel-inset rounded-xl px-3 py-3 text-sm">
                    <p className="font-medium">{citation.title}</p>
                    <p className="mt-1 text-[var(--color-text-muted)]">{citation.excerpt}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
