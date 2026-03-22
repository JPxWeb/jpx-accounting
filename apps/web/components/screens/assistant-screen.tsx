"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AssistantSession } from "@jpx-accounting/contracts";

import { apiClient } from "../../lib/client";
import { getErrorMessage } from "../../lib/request-errors";
import { formatRuntimeModeLabel } from "../../lib/presentation";
import { webRuntimeConfig } from "../../lib/runtime-config";
import { ScreenHeader } from "../ui/screen-header";
import { UnavailableState } from "../ui/unavailable-state";
import { SectionLabel } from "../ui/section-label";
import { ScreenSkeleton } from "../ui/skeleton";

export function AssistantScreen() {
  const [question, setQuestion] = useState("What should we double-check before deducting VAT on mixed receipts?");
  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });
  const { data } = workspaceQuery;

  const assistant = useMutation({
    mutationFn: (nextQuestion: string) =>
      apiClient.askAssistant({
        actorId: "user_founder",
        question: nextQuestion,
      }),
  });

  const assistantItems: AssistantSession[] = assistant.data
    ? [assistant.data]
    : (data?.assistantExamples ?? []);

  if (workspaceQuery.error && !data) {
    return (
      <UnavailableState
        testId="assistant-unavailable"
        title="Assistant unavailable"
        message={getErrorMessage(
          workspaceQuery.error,
          "The assistant could not be initialized. Check the runtime configuration and API availability.",
        )}
      />
    );
  }

  if (!data) {
    return <ScreenSkeleton />;
  }

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Advisor"
        title="Source-grounded finance guidance with room for human judgment."
        description="The advisory plane stays clearly separate from posting authority. It explains, recommends, cites, and creates review tasks, but it does not silently change the ledger."
        aside={
          <div className="glass-panel-soft rounded-2xl p-4">
            <SectionLabel>
              {formatRuntimeModeLabel(webRuntimeConfig.runtimeMode)}
            </SectionLabel>
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
              {webRuntimeConfig.runtimeMode === "demo"
                ? "Demo mode keeps the assistant local and explicit about scaffold behavior."
                : "Normal mode requires real provider configuration and fails closed when it is missing."}
            </p>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="glass-panel rounded-3xl p-5" data-testid="assistant-panel">
          <SectionLabel as="label" htmlFor="assistant-question">
            Ask a grounded question
          </SectionLabel>
          <textarea
            id="assistant-question"
            data-testid="assistant-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="glass-panel-inset mt-3 min-h-36 w-full rounded-xl px-4 py-4 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => assistant.mutate(question)}
            data-testid="assistant-submit"
            className="mt-4 rounded-xl bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-white"
          >
            Run advisory pass
          </button>

          {assistant.error ? (
            <p className="mt-4 rounded-2xl bg-[var(--color-danger-soft)] px-4 py-3 text-sm text-[var(--color-danger)]">
              {getErrorMessage(assistant.error, "The advisory request could not be completed.")}
            </p>
          ) : null}

          <div className="mt-6 space-y-4">
            {assistantItems.map((item) => (
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

        <section className="glass-panel rounded-3xl p-5">
          <h2 className="text-lg font-semibold">Policy and rules studio</h2>
          <div className="mt-4 space-y-3">
            {[
              "Effective-dated rules and prompts stored in code and mirrored into the database.",
              "Official, internal, and user-uploaded knowledge separated by trust level.",
              "Compliance watch can flag changes in public rules before advisory logic drifts.",
            ].map((item) => (
              <div key={item} className="glass-panel-soft rounded-xl px-4 py-3 text-sm text-[var(--color-text-muted)]">
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
