# EU AI Act Article 50 — internal assessment (draft)

> **STATUS:** Internal draft for engineering + product use only.
> **Counsel gate (Q3):** Do **not** reuse this document in customer contracts,
> marketing, App Store listings, or regulator-facing filings until external
> counsel has reviewed it. Nothing here is a legal opinion.

**Regulation:** [Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj), Article 50  
**Product:** JPX Accounting — AI advisory accounting PWA (Sweden-first)  
**Draft date:** 2026-08-06  
**Scope of this draft:** transparency obligations under Art. 50(1) and 50(2) as
implemented in the current codebase. Annex III / high-risk classification is
explicitly out of scope for this wave.

---

## 1. System overview (transparency-relevant)

JPX Accounting exposes AI in two human-facing surfaces:

| Surface                   | Mechanism                                                               | Mutates ledger?                                                                                    |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Advisor chat (`/advisor`) | AI SDK 7 UI-message SSE; demo uses deterministic `buildDemoAdvisorTurn` | **No** — `proposeReviewAction` executes only after signed human approval via `applyReviewDecision` |
| Review-queue suggestions  | Deterministic / extraction-assisted suggestions on `ReviewTask`         | **No** — posting requires an explicit human review decision                                        |

Invariant (product + AGENTS.md): **AI suggests, never mutates.** The review
queue is the only path to a posted voucher.

---

## 2. Article 50(1) — clear disclosure that the user is interacting with AI

**Obligation (plain language):** Users interacting with an AI system must be
informed that they are doing so, unless this is obvious from the circumstances.

**Current implementation (shipped):**

- Persistent advisor chrome badge + statement (`advisor.article50.*` in
  `messages/en.json` / `sv.json`).
- Per-assistant-message marker (`data-testid="ai-generated-marker"`, copy
  `advisor.aiGeneratedMarker`).
- Review-card AI suggestion blocks carry the same marker pattern
  (`today.card.aiGeneratedMarker`) so queue suggestions match chat labeling.
- Approval cards state that the draft is AI-proposed and that execution goes
  through the ordinary review gate (`advisor.approval.*`).

**Residual / honesty notes:**

- Demo mode is explicitly labeled as demo; it must never be presented as a live
  production AI deployment.
- When AI posture disables advisor or suggestions, surfaces show honest empty /
  disabled states rather than inventing depth.

---

## 3. Article 50(2) — machine-readable marking of AI-generated content

**Obligation (plain language):** Providers of AI systems generating synthetic
content must ensure outputs are marked in a machine-readable format (where
technically feasible), so they are detectable as artificially generated.

**Current implementation (this wave):**

- Advisor threads persisted in browser storage
  (`jpx.accounting.assistantThreads.v2`) carry an optional additive
  `aiTransparency` object on each saved thread:

  ```ts
  aiTransparency?: {
    labeling: "eu-ai-act-article-50";
    source: "advisor";
    markedAt: string; // ISO-8601
  }
  ```

- The field is set on every `prependAssistantThread` write. Existing v2 rows
  without the field remain valid (additive — no storage-version bump).
- Streamed retrieval honesty (Wave E-2) attaches a `data-retrieval`
  `{ mode: "vector" | "keyword" }` part so clients can distinguish vector hits
  from keyword fallback — related transparency, not a substitute for Art. 50(2)
  marking.

**Gaps acknowledged (not claimed complete):**

- Thread marking is **client-local** (localStorage). There is no server-side
  persistence of advisor transcripts yet, so machine-readable marking does not
  travel with exported/archive artifacts.
- Review suggestions live on ledger-derived `ReviewTask` records; they are
  UI-labeled (50(1)) but do not yet carry a dedicated machine-readable
  `aiTransparency` envelope on the wire contract.
- External/watermark-style detectors (beyond our own metadata) are not in scope.

---

## 4. What we are **not** claiming

- That JPX Accounting is (or is not) an Annex III high-risk AI system.
- That Art. 50 compliance is “done” for every future AI surface.
- That this draft satisfies any national supervisory authority’s filing format.
- That demo-mode deterministic answers are free of Art. 50 duties when presented
  as AI assistance — they remain labeled AI-generated.

---

## 5. Follow-ups (engineering backlog, counsel-gated for external claims)

1. Persist `aiTransparency` (or equivalent) if/when advisor transcripts gain a
   server store or export path.
2. Consider a contracts-level optional marker on suggestion payloads once a
   multi-tenant export story exists.
3. Re-open this assessment when a new AI surface ships (e.g. batch narrative
   generation, outbound email drafts).
4. Counsel review before any public Art. 50 compliance statement.

---

## 6. Change control

| Date       | Change                                 | Authoring context     |
| ---------- | -------------------------------------- | --------------------- |
| 2026-08-06 | Initial internal draft (Wave E′ / E-1) | Post–Wave C Share′+E′ |

_End of internal draft._
