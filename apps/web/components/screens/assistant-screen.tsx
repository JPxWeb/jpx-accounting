"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { AssistantSession } from "@jpx-accounting/contracts";

import { apiClient } from "../../lib/client";
import { ScreenHeader } from "../ui/screen-header";

export function AssistantScreen() {
  const [question, setQuestion] = useState("What should we double-check before deducting VAT on mixed receipts?");
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
  });

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

  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Advisor"
        title="Source-grounded finance guidance with room for human judgment."
        description="The advisory plane stays clearly separate from posting authority. It explains, recommends, cites, and creates review tasks, but it does not silently change the ledger."
        aside={
          <div className="glass-panel-soft rounded-[24px] p-4">
            <p className="text-[0.7rem] uppercase tracking-[0.18em] text-[var(--color-text-muted)]">Response posture</p>
            <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
              Answers must be grounded in official or internal sources. If retrieval is weak, the assistant should say so.
            </p>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="glass-panel rounded-[28px] p-5" data-testid="assistant-panel">
          <label className="text-xs uppercase tracking-[0.22em] text-[var(--color-text-muted)]" htmlFor="assistant-question">
            Ask a grounded question
          </label>
          <textarea
            id="assistant-question"
            data-testid="assistant-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            className="mt-3 min-h-36 w-full rounded-[24px] border border-[var(--color-border)] bg-white/70 px-4 py-4 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => assistant.mutate(question)}
            data-testid="assistant-submit"
            className="mt-4 rounded-full bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-white"
          >
            Run advisory pass
          </button>

          <div className="mt-6 space-y-4">
            {assistantItems.map((item) => (
              <article key={item.id} data-testid="assistant-response" className="glass-panel-soft rounded-[24px] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-text-muted)]">{item.status}</p>
                <h2 className="mt-2 text-lg font-semibold">{item.question}</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">{item.answer}</p>
                <div className="mt-4 space-y-2">
                  {item.citations.map((citation) => (
                    <div key={citation.id} className="rounded-[18px] bg-white/70 px-3 py-3 text-sm">
                      <p className="font-medium">{citation.title}</p>
                      <p className="mt-1 text-[var(--color-text-muted)]">{citation.excerpt}</p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="glass-panel rounded-[28px] p-5">
          <h2 className="text-lg font-semibold">Policy and rules studio</h2>
          <div className="mt-4 space-y-3">
            {[
              "Effective-dated rules and prompts stored in code and mirrored into the database.",
              "Official, internal, and user-uploaded knowledge separated by trust level.",
              "Compliance watch can flag changes in public rules before advisory logic drifts.",
            ].map((item) => (
              <div key={item} className="rounded-[20px] bg-white/60 px-4 py-3 text-sm text-[var(--color-text-muted)]">
                {item}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
