# Track A · Phase 6 — Global Cmd-K Advisor palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Complete tasks in order.

**Goal:** Add a global keyboard palette (⌘K / Ctrl+K) that combines navigation, AI Q&A, knowledge lookup, and simulations from any route, while `/assistant` stays as read-only session history.

**Architecture:** A client `AdvisorPaletteProvider` mounted at the root layout (inside the existing `QueryProvider` + `NuqsAdapter`) exposes `useAdvisor()`. The palette is shadcn's `CommandDialog` (cmdk). Input prefix selects the mode: nav (client routing), ask (`POST /api/assistant/sessions`), lookup, simulate (`POST /api/simulations/run`). `?advisor=open` (the legacy `/assistant` link) auto-opens it. Global hotkeys use the already-installed `react-hotkeys-hook`.

**Tech Stack:** Next.js 16 App Router, React 19.2.4, `cmdk@^1` + shadcn `command`, nuqs 2, `react-hotkeys-hook` 5, TanStack Query 5, Playwright + axe-core.

**Spec:** `docs/superpowers/specs/2026-05-19-track-a-finish-ia-design.md` §4.3 (re-baseline correction #5: assistant API is non-streaming), parent §5.1, §5.4.

---

## Re-baseline corrections applied in this plan

- **Non-streaming Ask (#5):** `POST /api/assistant/sessions` returns a complete `AssistantSession` JSON. Ask mode shows a loading state then the full answer + citation chips. No fake token streaming.
- **`/mcp` is a non-executing echo stub.** `services/api/src/app.ts:246` returns `{ server, tools, request }` — it does not run the named tool. Therefore **Lookup mode routes through the grounded assistant endpoint** (`apiClient.askAssistant`, the same stack `/api/knowledge/query` documents itself as using) with a domain-prefixed query, rather than `/mcp`. This is functional in both demo-fallback and HTTP modes and needs no new endpoint. Recorded here as an intentional deviation from parent spec §5.1.
- **`/assistant` is not redirected.** `apps/web/proxy.ts` only redirects `/` and `/settings`. `/assistant` remains the history page; this plan adds no redirect. The existing "Open Advisor (⌘K)" link already targets `/today?advisor=open`.
- **Discoverability affordance is provider-rendered**, not an edit to the large `app-shell.tsx` top bar (reduces blast radius; satisfies the spec's discoverability intent).

## File map

| Path | Action |
|---|---|
| `apps/web/package.json` | Modify — add `cmdk` |
| `apps/web/components/ui/command.tsx` | Create (shadcn) |
| `apps/web/components/advisor/advisor-palette-provider.tsx` | Create — context + hotkeys + `?advisor=open` |
| `apps/web/components/advisor/advisor-palette.tsx` | Create — the `CommandDialog` + modes |
| `apps/web/app/layout.tsx` | Modify — mount the provider |
| `tests/e2e/advisor-palette.spec.ts` | Create |

---

## Conventions (read once)

- Baseline `pnpm typecheck` passes before starting.
- Test gate is `tests/e2e/advisor-palette.spec.ts` + `pnpm typecheck && pnpm build` (no UI unit tests in this repo).
- Demo identity: `actorId: "user_founder"`.
- Commit after every task.

---

## Task 6.1: Install cmdk + shadcn command

**Files:** `apps/web/package.json`, `apps/web/components/ui/command.tsx`

- [ ] **Step 1: Install**

```bash
pnpm --filter @jpx-accounting/web add cmdk@^1
pnpm --filter @jpx-accounting/web exec shadcn@latest add command
```

Accept creation of `apps/web/components/ui/command.tsx`. Decline overwriting any other existing file.

- [ ] **Step 2: Verify the generated exports**

Open `apps/web/components/ui/command.tsx` and confirm it exports `Command`, `CommandDialog`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandSeparator`. If a name differs in the generated file, use the generated names in Task 6.3 (do not rename the shadcn file).

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm typecheck` → PASS.

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/components/ui/command.tsx
git commit -m "chore(track-a/p6): add cmdk + shadcn command primitive"
```

---

## Task 6.2: Advisor palette provider (context, hotkeys, ?advisor=open)

**Files:** Create `apps/web/components/advisor/advisor-palette-provider.tsx`; modify `apps/web/app/layout.tsx`

- [ ] **Step 1: Implement the provider**

Create `apps/web/components/advisor/advisor-palette-provider.tsx`:

```tsx
"use client";

import { parseAsString, useQueryState } from "nuqs";
import { usePathname, useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AdvisorPalette } from "./advisor-palette";

type AdvisorContextValue = { open: boolean; openPalette: () => void; closePalette: () => void };

const AdvisorContext = createContext<AdvisorContextValue | null>(null);

export function useAdvisor() {
  const ctx = useContext(AdvisorContext);
  if (!ctx) throw new Error("useAdvisor must be used within AdvisorPaletteProvider");
  return ctx;
}

const NAV_CHORDS: Record<string, string> = {
  t: "/today",
  c: "/capture",
  b: "/books",
  r: "/reports",
  s: "/settings",
};

export function AdvisorPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const [advisorParam, setAdvisorParam] = useQueryState("advisor", parseAsString);
  const chordArmed = useRef(false);
  const chordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);

  // Global open shortcut (mod = Cmd on macOS, Ctrl elsewhere).
  useHotkeys("mod+k", (event) => {
    event.preventDefault();
    setOpen((value) => !value);
  });

  // Legacy `/assistant` → `/today?advisor=open` auto-open, then clear the param.
  useEffect(() => {
    if (advisorParam === "open") {
      setOpen(true);
      void setAdvisorParam(null);
    }
  }, [advisorParam, setAdvisorParam]);

  // `g` then a target key navigation chords (skip when typing or palette open).
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      const el = target as HTMLElement | null;
      return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable));
    }
    function onKeyDown(event: KeyboardEvent) {
      if (open || isTypingTarget(event.target)) return;
      if (event.key === "g") {
        chordArmed.current = true;
        if (chordTimer.current) clearTimeout(chordTimer.current);
        chordTimer.current = setTimeout(() => {
          chordArmed.current = false;
        }, 800);
        return;
      }
      if (chordArmed.current) {
        const destination = NAV_CHORDS[event.key];
        chordArmed.current = false;
        if (destination && destination !== pathname) {
          event.preventDefault();
          router.push(destination);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, pathname, router]);

  return (
    <AdvisorContext.Provider value={{ open, openPalette, closePalette }}>
      {children}
      <button
        type="button"
        data-testid="advisor-open-button"
        onClick={openPalette}
        className="fixed bottom-4 left-4 z-40 rounded-full border bg-[var(--color-surface)] px-4 py-2 text-xs font-medium shadow"
      >
        Ask · ⌘K
      </button>
      <AdvisorPalette open={open} onOpenChange={setOpen} />
    </AdvisorContext.Provider>
  );
}
```

- [ ] **Step 2: Mount it in the root layout**

In `apps/web/app/layout.tsx`, add the import and wrap `{children}` (inside `<NuqsAdapter>` so the provider's `useQueryState` works, inside `<QueryProvider>` so palette mutations work):

```tsx
import { AdvisorPaletteProvider } from "../components/advisor/advisor-palette-provider";
```

Change the body tree from:

```tsx
        <QueryProvider>
          <NuqsAdapter>
            <ServiceWorkerRegistrar />
            {children}
          </NuqsAdapter>
        </QueryProvider>
```

to:

```tsx
        <QueryProvider>
          <NuqsAdapter>
            <ServiceWorkerRegistrar />
            <AdvisorPaletteProvider>{children}</AdvisorPaletteProvider>
          </NuqsAdapter>
        </QueryProvider>
```

- [ ] **Step 3: Commit (build runs after the palette exists in Task 6.3)**

```bash
git add apps/web/components/advisor/advisor-palette-provider.tsx apps/web/app/layout.tsx
git commit -m "feat(track-a/p6): advisor palette provider, global ⌘K, nav chords, ?advisor=open"
```

---

## Task 6.3: The palette (modes: nav / ask / lookup / simulate)

**Files:** Create `apps/web/components/advisor/advisor-palette.tsx`

- [ ] **Step 1: Implement the palette**

Create `apps/web/components/advisor/advisor-palette.tsx`:

```tsx
"use client";

import type { AssistantSession, SimulationRun } from "@jpx-accounting/contracts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiClient } from "../../lib/client";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";

const ROUTES: { label: string; href: string }[] = [
  { label: "Go to Today", href: "/today" },
  { label: "Go to Capture", href: "/capture" },
  { label: "Go to Books", href: "/books" },
  { label: "Go to Reports", href: "/reports" },
  { label: "Go to Settings", href: "/settings/company" },
];

type Result =
  | { kind: "assistant"; data: AssistantSession }
  | { kind: "simulation"; data: SimulationRun }
  | null;

function modeFor(value: string): "ask" | "lookup" | "simulate" | "nav" {
  if (value.startsWith("?")) return "ask";
  if (value.startsWith("/policy") || value.startsWith("/vat") || value.startsWith("/supplier")) return "lookup";
  if (value.startsWith("sim:")) return "simulate";
  return "nav";
}

export function AdvisorPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const mode = modeFor(value);

  async function submit() {
    setPending(true);
    setResult(null);
    try {
      if (mode === "ask") {
        const answer = await apiClient.askAssistant({
          actorId: "user_founder",
          question: value.replace(/^\?/, "").trim(),
        });
        setResult({ kind: "assistant", data: answer });
      } else if (mode === "lookup") {
        const answer = await apiClient.askAssistant({
          actorId: "user_founder",
          question: `Knowledge lookup — ${value.trim()}`,
        });
        setResult({ kind: "assistant", data: answer });
      } else if (mode === "simulate") {
        const sim = await apiClient.runSimulation({
          actorId: "user_founder",
          title: "Palette simulation",
          scenario: value.replace(/^sim:/, "").trim(),
        });
        setResult({ kind: "simulation", data: sim });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <div data-testid="advisor-palette">
        <CommandInput
          placeholder="Type to navigate · ? to ask · /policy /vat /supplier to look up · sim: to simulate"
          value={value}
          onValueChange={setValue}
          onKeyDown={(event) => {
            if (event.key === "Enter" && mode !== "nav") {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <CommandList>
          {mode === "nav" ? (
            <>
              <CommandEmpty>No matching destination.</CommandEmpty>
              <CommandGroup heading="Navigate">
                {ROUTES.map((route) => (
                  <CommandItem
                    key={route.href}
                    value={route.label}
                    onSelect={() => {
                      onOpenChange(false);
                      router.push(route.href);
                    }}
                  >
                    {route.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : (
            <CommandGroup heading={mode === "simulate" ? "Simulate" : mode === "lookup" ? "Lookup" : "Ask the advisor"}>
              <div className="px-3 py-3 text-sm" data-testid="advisor-result">
                {pending ? (
                  <p data-testid="advisor-pending">Working…</p>
                ) : result?.kind === "assistant" ? (
                  <div>
                    <p className="leading-6">{result.data.answer}</p>
                    <div className="mt-3 space-y-2">
                      {result.data.citations.map((citation) => (
                        <p key={citation.id} data-testid="advisor-citation" className="text-xs text-[var(--color-text-muted)]">
                          {citation.title} — {citation.excerpt}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : result?.kind === "simulation" ? (
                  <div>
                    <p className="leading-6">{result.data.outcomeSummary}</p>
                    <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                      Affected accounts: {result.data.affectedAccounts.join(", ")}
                    </p>
                  </div>
                ) : (
                  <p className="text-[var(--color-text-muted)]">Press Enter to run.</p>
                )}
              </div>
            </CommandGroup>
          )}
        </CommandList>
      </div>
    </CommandDialog>
  );
}
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm typecheck && pnpm --filter @jpx-accounting/web build`
Expected: PASS. If `CommandInput` lacks `onValueChange`/`value` props in the generated shadcn file, use the cmdk `<Command shouldFilter={false}>` props the generator exposes (cmdk's `CommandInput` supports `value`/`onValueChange`); align prop names to the generated component.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/advisor/advisor-palette.tsx
git commit -m "feat(track-a/p6): advisor palette modes — nav, ask, lookup, simulate"
```

---

## Task 6.4: E2E coverage

**Files:** Create `tests/e2e/advisor-palette.spec.ts`

- [ ] **Step 1: Write the spec**

Create `tests/e2e/advisor-palette.spec.ts`:

```typescript
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { resetApiState } from "./test-helpers";

test.beforeEach(async ({ request }) => {
  await resetApiState(request);
});

test("⌘K / Ctrl+K opens the advisor palette from any route", async ({ page }) => {
  await page.goto("/today");
  await page.keyboard.press("ControlOrMeta+KeyK");
  await expect(page.getByTestId("advisor-palette")).toBeVisible();
});

test("the discoverability button opens the palette on Reports too", async ({ page }) => {
  await page.goto("/reports");
  await page.getByTestId("advisor-open-button").click();
  await expect(page.getByTestId("advisor-palette")).toBeVisible();
});

test("ask mode returns a grounded answer with citations", async ({ page }) => {
  await page.goto("/today");
  await page.getByTestId("advisor-open-button").click();
  await page.getByTestId("advisor-palette").getByRole("combobox").fill("?can we deduct this VAT");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("advisor-result")).toBeVisible();
  await expect(page.getByTestId("advisor-citation").first()).toBeVisible();
});

test("legacy /assistant history link auto-opens the palette via ?advisor=open", async ({ page }) => {
  await page.goto("/assistant");
  await expect(page.getByTestId("assistant-panel")).toBeVisible();
  await page.getByTestId("open-advisor-button").click();
  await expect(page).toHaveURL(/\/today/);
  await expect(page.getByTestId("advisor-palette")).toBeVisible();
});

test("palette has no serious accessibility violations", async ({ page }) => {
  await page.goto("/today");
  await page.getByTestId("advisor-open-button").click();
  await expect(page.getByTestId("advisor-palette")).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm build && npx playwright test tests/e2e/advisor-palette.spec.ts`
Expected: 5 tests PASS on both projects. If the `combobox` role locator does not match the generated cmdk input, replace with `page.getByPlaceholder("Type to navigate")`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/advisor-palette.spec.ts
git commit -m "test(track-a/p6): advisor palette e2e — open, ask, legacy link, axe"
```

---

## Phase 6 acceptance check

- [ ] `⌘K` / `Ctrl+K` opens the palette from any route; `Esc` closes (cmdk built-in)
- [ ] Nav mode lists the 5 primary routes and navigates on select; `g`+`t/c/b/r/s` chords navigate when not typing
- [ ] `?` switches to Ask and renders a complete answer with citation chips (non-streaming)
- [ ] `/policy|/vat|/supplier` returns a grounded lookup; `sim:` returns a simulation summary
- [ ] Legacy `/assistant` still shows history; its "Open Advisor" link lands on `/today` with the palette open
- [ ] `pnpm typecheck && pnpm build && pnpm test:e2e` pass; axe clean with the palette open

## Self-review summary

- **Spec coverage (§4.3, §5.1, §5.4):** provider at root with `useAdvisor()` (6.2); `CommandDialog` palette with 4 prefix modes (6.3); `?advisor=open` auto-open (6.2); global `mod+k` + `g` chords via `react-hotkeys-hook`/keydown (6.2); `/assistant` stays history (no proxy change). Re-baseline corrections (#5 non-streaming; `/mcp` echo → grounded lookup; provider-rendered affordance) are documented at the top and reflected in code.
- **Placeholders:** none — full provider + palette code; fallback notes for shadcn-generated prop/locator name drift.
- **Type consistency:** `AssistantSession`/`SimulationRun` from contracts typed in the `Result` union and rendered accordingly; `apiClient.askAssistant`/`runSimulation` signatures match `packages/api-client` exactly (`{actorId, question}` / `{actorId, title, scenario}`); `useAdvisor()` context shape is stable.
- **Backout:** each task is one revertable commit; reverting 6.3 leaves the provider/hotkeys harmless (no dialog content) — revert 6.2 as well to fully remove.
