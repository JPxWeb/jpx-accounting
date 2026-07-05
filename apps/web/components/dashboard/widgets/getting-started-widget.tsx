"use client";

// Check stays local instead of going through components/ui/icons.tsx — same
// convention as widget-chrome.tsx (icons consolidation is a follow-up).
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSyncExternalStore } from "react";

import { loadAssistantThreads } from "../../../lib/assistant-thread-storage";
import { webRuntimeConfig } from "../../../lib/runtime-config";
import type { DashboardData } from "../use-dashboard-data";

/**
 * Getting-started checklist (Task 6.1): five onboarding steps derived PURELY
 * from data the dashboard already fetches — no step state is stored anywhere.
 * A step is "done" when the underlying artifact exists, so completion survives
 * reloads and other devices for free (except the advisor step, which reads the
 * local thread history and is honest about being per-browser).
 *
 * When every step is done the widget shows a calm all-done note with a hint to
 * hide it — it never removes itself; `removeWidget` stays user-controlled.
 */

/** Demo seeds exactly ONE evidence object (`MemoryLedgerStore` constructor); normal mode starts empty. */
const SEEDED_EVIDENCE_COUNT = webRuntimeConfig.runtimeMode === "demo" ? 1 : 0;

const STEP_KEYS = ["capture", "approve", "import", "advisor", "profile"] as const;
type StepKey = (typeof STEP_KEYS)[number];

const STEP_HREFS: Record<StepKey, string> = {
  capture: "/capture",
  approve: "/today?view=queue",
  // SIE import lives in the Quick-add grid on the capture screen.
  import: "/capture",
  advisor: "/assistant",
  profile: "/settings/company",
};

/** Same-tab writes re-render on remount (route change); other tabs via `storage`. */
function subscribeToLocalStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function hasAdvisorThread(): boolean {
  return loadAssistantThreads().length > 0;
}

function noAdvisorThreadOnServer(): boolean {
  return false;
}

export function GettingStartedWidget({ data }: { data: DashboardData }) {
  const t = useTranslations("dashboard.widgets.getting-started");
  const tDashboard = useTranslations("dashboard");
  const advisorAsked = useSyncExternalStore(subscribeToLocalStorage, hasAdvisorThread, noAdvisorThreadOnServer);

  const snapshot = data.snapshot;
  if (!snapshot) {
    return <p className="text-sm text-muted-foreground">{tDashboard("loading")}</p>;
  }

  const done: Record<StepKey, boolean> = {
    capture: snapshot.evidence.length > SEEDED_EVIDENCE_COUNT,
    // Affirmative review decisions only — a rejection is a decision, but not an approval.
    approve: snapshot.reviews.some((review) => review.status === "approved" || review.status === "booked-without-vat"),
    // Imported lines keep their `sie_<series>_<number>` voucher id in the journal (append-only replay truth).
    import: snapshot.reports.journal.some((entry) => entry.voucherId.startsWith("sie_")),
    advisor: advisorAsked,
    // `null` = never saved; `undefined` = still loading (renders as not-done for a moment).
    profile: Boolean(data.settings),
  };
  const doneCount = STEP_KEYS.filter((key) => done[key]).length;

  if (doneCount === STEP_KEYS.length) {
    return (
      <div className="space-y-2" data-testid="getting-started-all-done">
        <p className="text-sm font-semibold text-foreground">{t("allDoneTitle")}</p>
        <p className="text-sm leading-6 text-muted-foreground">{t("allDoneHint")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p data-testid="getting-started-progress" className="text-sm text-muted-foreground">
        {t("progress", { done: doneCount, total: STEP_KEYS.length })}
      </p>
      <ul className="space-y-2">
        {STEP_KEYS.map((key) => (
          <li key={key}>
            <Link
              href={STEP_HREFS[key]}
              data-testid={`getting-started-step-${key}`}
              data-complete={done[key]}
              className="glass-panel-soft flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span
                aria-hidden
                className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
                  done[key] ? "bg-success-soft text-success" : "border border-border text-transparent"
                }`}
              >
                <Check className="size-3.5" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-sm font-medium ${
                    done[key] ? "text-muted-foreground line-through" : "text-foreground"
                  }`}
                >
                  {t(`steps.${key}.label`)}
                  {done[key] ? <span className="sr-only"> — {t("stepDone")}</span> : null}
                </span>
                <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                  {t(`steps.${key}.hint`)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
