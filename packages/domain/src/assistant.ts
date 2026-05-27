import type { AssistantSession } from "@jpx-accounting/contracts";

import { createId } from "./ids";

// Shared scaffold for assistant responses. When the real Azure AI advisor
// lands (IA Phase 6 Cmd-K Advisor), this single function is replaced with a
// call to aiRuntime.answer(question) and neither store implementation changes.
export function buildAssistantScaffold(question: string): AssistantSession {
  return {
    id: createId("assistant"),
    question,
    answer:
      "This scaffold uses grounded, citation-first advisory. In production the answer would combine Azure AI Search retrieval, policy sources, and Responses API reasoning before it reaches the reviewer.",
    status: "grounded",
    citations: [
      {
        id: "cit_arch",
        title: "Internal architecture policy",
        sourceType: "internal",
        excerpt:
          "AI may suggest and explain, but may not silently mutate accounting state.",
      },
    ],
  };
}
