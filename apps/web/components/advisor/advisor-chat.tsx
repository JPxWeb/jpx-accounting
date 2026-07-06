"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type ChatTransport } from "ai";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  deriveThreadTitle,
  prependAssistantThread,
  type StoredAssistantThread,
} from "../../lib/assistant-thread-storage";
import { getErrorMessage } from "../../lib/request-errors";
import { webRuntimeConfig } from "../../lib/runtime-config";
import { SectionLabel } from "../ui/section-label";
import { LocalDemoChatTransport, PROPOSE_REVIEW_ACTION_PART_TYPE, type AdvisorUIMessage } from "./local-demo-transport";
import { MessagePart } from "./message-part";
import { SuggestedPrompts } from "./suggested-prompts";

/**
 * The advisor chat surface (Task 5.9): AI SDK 7 `useChat` over one of two
 * transports — the same-origin SSE route (`POST /api/advisor/chat`) whenever an
 * API base URL exists, or `LocalDemoChatTransport` replaying the deterministic
 * demo turn client-side when the api-client fallback store is active (demo
 * offline). Tool approvals round-trip via `addToolApprovalResponse` +
 * `sendAutomaticallyWhen`; execution always happens behind the review gate.
 */
export function AdvisorChat({
  thread,
  onThreadsChange,
}: {
  thread: { id: string; messages: AdvisorUIMessage[] };
  onThreadsChange: (threads: StoredAssistantThread[]) => void;
}) {
  const t = useTranslations("advisor");
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");

  const transport = useMemo<ChatTransport<AdvisorUIMessage>>(() => {
    // Demo mode without an API base URL = the api-client fallback store is
    // active (see AccountingApiClient) — replay the demo brain client-side.
    if (webRuntimeConfig.runtimeMode === "demo" && !webRuntimeConfig.apiBaseUrl) {
      return new LocalDemoChatTransport();
    }
    return new DefaultChatTransport<AdvisorUIMessage>({
      api: `${webRuntimeConfig.apiBaseUrl ?? ""}/api/advisor/chat`,
    });
  }, []);

  const { messages, sendMessage, status, error, clearError, addToolApprovalResponse } = useChat<AdvisorUIMessage>({
    id: thread.id,
    messages: thread.messages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ message, messages: finishedMessages, isError }) => {
      if (isError || finishedMessages.length === 0) return;
      onThreadsChange(
        prependAssistantThread({
          id: thread.id,
          title: deriveThreadTitle(finishedMessages, t("threads.untitled")),
          messages: finishedMessages,
        }),
      );
      // An executed approval changed the ledger — refresh everything derived
      // from it (queue snapshot, hash chain, report packs).
      const executedReviewAction = message.parts.some(
        (part) => part.type === PROPOSE_REVIEW_ACTION_PART_TYPE && part.state === "output-available",
      );
      if (executedReviewAction) {
        void queryClient.invalidateQueries({ queryKey: ["workspace"] });
        void queryClient.invalidateQueries({ queryKey: ["integrity"] });
        void queryClient.invalidateQueries({ queryKey: ["reports", "pack"] });
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";

  function submitQuestion(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <div className="space-y-4" data-tour="advisor-chat">
      {messages.length === 0 ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted-foreground">{t("emptyState")}</p>
          <SuggestedPrompts onPick={submitQuestion} disabled={busy} />
        </div>
      ) : (
        <ol data-testid="advisor-messages" className="space-y-4">
          {messages.map((message) => (
            <li
              key={message.id}
              data-testid="advisor-message"
              data-role={message.role}
              className={
                message.role === "user"
                  ? "ml-auto max-w-[85%] rounded-xl bg-primary-soft px-4 py-3"
                  : "glass-panel-soft max-w-full rounded-xl px-4 py-3"
              }
            >
              {message.role === "assistant" ? (
                <p
                  data-testid="ai-generated-marker"
                  className="text-caption mb-2 inline-flex rounded-md bg-info-soft px-2 py-0.5 font-semibold text-info"
                >
                  {t("aiGeneratedMarker")}
                </p>
              ) : null}
              <div className="space-y-3">
                {message.parts.map((part, index) => (
                  <MessagePart
                    key={`${message.id}-${index}`}
                    part={part}
                    busy={busy}
                    onApprovalResponse={(approvalId, approved) =>
                      void addToolApprovalResponse({ id: approvalId, approved })
                    }
                  />
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}

      {busy ? (
        <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="advisor-streaming">
          {t("input.streaming")}
        </p>
      ) : null}

      {error ? (
        <div className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          <p>{getErrorMessage(error, t("error.fallback"))}</p>
          <button
            type="button"
            onClick={clearError}
            className="mt-2 text-sm font-semibold underline underline-offset-2"
          >
            {t("error.dismiss")}
          </button>
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitQuestion(input);
        }}
      >
        <SectionLabel as="label" htmlFor="assistant-question">
          {t("input.label")}
        </SectionLabel>
        <textarea
          id="assistant-question"
          data-testid="assistant-question"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submitQuestion(input);
            }
          }}
          placeholder={t("input.placeholder")}
          aria-describedby="assistant-question-hint"
          className="glass-panel-inset mt-3 min-h-24 w-full rounded-xl px-4 py-3 text-sm outline-none"
        />
        <p id="assistant-question-hint" className="mt-2 text-xs text-muted-foreground">
          {t("input.hint")}
        </p>
        <button
          type="submit"
          disabled={busy || !input.trim()}
          data-testid="assistant-submit"
          className="mt-3 w-full rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
        >
          {busy ? t("input.streaming") : t("input.send")}
        </button>
      </form>
    </div>
  );
}
