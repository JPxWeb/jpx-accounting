"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { saveCaptureDraft } from "../lib/draft-queue";
import type { DraftQueueSaveResult } from "../lib/draft-queue-core";
import { formatRuntimeModeLabel } from "../lib/presentation";
import { webRuntimeConfig } from "../lib/runtime-config";
import { AdvisorIcon, CaptureIcon, ControlIcon, InboxIcon, ReportsIcon, SparkIcon } from "./ui/icons";
import { StatusBadge } from "./ui/status-badge";

const navigation = [
  { href: "/", label: "Inbox", summary: "Evidence and review queue", icon: InboxIcon },
  { href: "/reports", label: "Reports", summary: "Journal, balances, and VAT", icon: ReportsIcon },
  { href: "/assistant", label: "Advisor", summary: "Grounded finance guidance", icon: AdvisorIcon },
  { href: "/settings", label: "Control", summary: "Guardrails and deployment posture", icon: ControlIcon },
];

const draftModes = [
  { key: "camera", label: "Camera" },
  { key: "upload", label: "Upload" },
  { key: "paste", label: "Paste" },
  { key: "share", label: "Share" },
];

type CaptureStatus = {
  tone: "success" | "warning" | "error";
  message: string;
};

const focusableSelector = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function buildCaptureStatusMessage(modeLabel: string, result: DraftQueueSaveResult): CaptureStatus {
  if (result.storage === "indexeddb") {
    return {
      tone: "success",
      message: `${modeLabel} draft saved locally in IndexedDB.`,
    };
  }

  if (result.storage === "session") {
    return {
      tone: "warning",
      message: `${modeLabel} draft saved for this browser tab only.`,
    };
  }

  return {
    tone: "warning",
    message: `${modeLabel} draft saved in temporary memory for this tab only.`,
  };
}

function getFocusableElements(container: HTMLElement | null) {
  if (!container) {
    return [];
  }

  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => !element.hasAttribute("disabled") && element.tabIndex !== -1,
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null);
  const timestamp = useMemo(() => new Intl.DateTimeFormat("sv-SE").format(new Date()), []);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstDraftActionRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const runtimeModeLabel = formatRuntimeModeLabel(webRuntimeConfig.runtimeMode);
  const activeNavItem = useMemo(
    () =>
      navigation.find((item) => (item.href === "/" ? pathname === item.href : pathname.startsWith(item.href))) ??
      navigation[0]!,
    [pathname],
  );

  const closeCaptureSheet = useEffectEvent(() => {
    setCaptureOpen(false);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  });

  useEffect(() => {
    if (!captureStatus) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCaptureStatus(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [captureStatus]);

  useEffect(() => {
    if (!captureOpen) {
      return undefined;
    }

    const dialog = dialogRef.current;
    const focusableElements = getFocusableElements(dialog);
    const initialFocusTarget = firstDraftActionRef.current ?? focusableElements[0];
    initialFocusTarget?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCaptureSheet();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const currentFocusableElements = getFocusableElements(dialogRef.current);
      if (currentFocusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = currentFocusableElements[0]!;
      const lastElement = currentFocusableElements[currentFocusableElements.length - 1]!;

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [captureOpen]);

  async function createDraft(mode: { key: string; label: string }) {
    try {
      const result = await saveCaptureDraft({
        id: crypto.randomUUID(),
        mode: mode.key,
        title: `${mode.label} draft`,
        createdAt: new Date().toISOString(),
      });
      setCaptureStatus(buildCaptureStatusMessage(mode.label, result));
      closeCaptureSheet();
    } catch {
      setCaptureStatus({
        tone: "error",
        message: `${mode.label} draft could not be saved locally. Check browser storage permissions and try again.`,
      });
    }
  }

  function openCaptureSheet(event: MouseEvent<HTMLButtonElement>) {
    returnFocusRef.current = event.currentTarget;
    setCaptureOpen(true);
  }

  return (
    <div className="app-shell">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.42),_transparent_45%)]" />
      <div className="shell-layout">
        <aside className="shell-rail" data-testid="desktop-navigation">
          <div className="shell-rail-inner">
            <section className="glass-chrome rounded-4xl px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-eyebrow">JPX Accounting</p>
                <StatusBadge
                  status={runtimeModeLabel}
                  variant={webRuntimeConfig.runtimeMode === "demo" ? "warning" : "accent"}
                />
              </div>
              <h1 className="mt-3 text-2xl font-semibold leading-tight">
                Trustworthy AI bookkeeping for Sweden-first teams.
              </h1>
              <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                Compliance-critical flows stay deterministic. AI guides, cites, and accelerates the review surface.
              </p>
              {webRuntimeConfig.runtimeMode === "demo" ? (
                <p className="mt-4 rounded-2xl bg-[var(--color-warning-soft)] px-4 py-3 text-sm text-[var(--color-warning)]">
                  Demo mode is intentionally using local scaffold behavior so it is never mistaken for live accounting.
                </p>
              ) : null}
            </section>

            <nav className="glass-panel rounded-4xl p-3" aria-label="Primary" data-testid="desktop-navigation-links">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-start gap-3 rounded-2xl px-4 py-4 transition ${
                      active
                        ? "bg-[var(--color-accent)] text-white shadow-[var(--shadow-sm)]"
                        : "text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.72)]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 rounded-xl p-2 ${
                        active
                          ? "bg-white/16 text-white"
                          : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                      }`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span
                        className={`mt-1 block text-xs ${active ? "text-white/78" : "text-[var(--color-text-muted)]"}`}
                      >
                        {item.summary}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </nav>

            <section className="glass-panel rounded-4xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-eyebrow">Capture lane</p>
                  <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                    Camera, paste, upload, and share land in the same queue and show where the draft was stored.
                  </p>
                </div>
                <StatusBadge status="Local-first" variant="accent" />
              </div>
              <button
                type="button"
                onClick={openCaptureSheet}
                data-testid="capture-open-desktop"
                className="capture-button-desktop mt-4 w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 py-4 text-sm font-semibold text-white shadow-[var(--shadow-md)]"
              >
                <CaptureIcon className="size-4" />
                Capture Evidence
              </button>
            </section>

            <section className="glass-panel-soft mt-auto rounded-4xl p-4">
              <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                <SparkIcon className="size-4 text-[var(--color-accent)]" />
                <span className="text-eyebrow">Innovation track</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                Voice capture, simulations, and close copilot are isolated from posting authority until they earn trust.
              </p>
            </section>
          </div>
        </aside>

        <div className="shell-main">
          <header className="page-shell page-shell-compact shell-topbar" data-testid="app-shell-header">
            <div className="glass-chrome flex items-center justify-between gap-4 rounded-3xl px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-eyebrow">JPX Accounting</p>
                  <StatusBadge
                    status={runtimeModeLabel}
                    variant={webRuntimeConfig.runtimeMode === "demo" ? "warning" : "accent"}
                    testId="runtime-mode-pill"
                  />
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">{activeNavItem.label}</p>
                  <span className="hidden h-1 w-1 rounded-full bg-[var(--color-text-soft)] sm:block" />
                  <p className="hidden truncate text-sm text-[var(--color-text-muted)] sm:block">
                    {activeNavItem.summary}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden rounded-xl glass-panel-soft px-3 py-2 text-right text-xs text-[var(--color-text-muted)] sm:block">
                  <div className="font-medium text-[var(--color-text)]">Sweden Central / Stockholm</div>
                  <div>{timestamp}</div>
                </div>
                <button
                  type="button"
                  onClick={openCaptureSheet}
                  data-testid="capture-open-mobile"
                  className="capture-button-mobile flex items-center gap-2 rounded-xl bg-[var(--color-accent)] px-5 py-4 text-sm font-semibold text-white shadow-[var(--shadow-sm)] lg:hidden"
                >
                  <CaptureIcon className="size-4" />
                  Capture
                </button>
              </div>
            </div>
          </header>

          {webRuntimeConfig.runtimeMode === "demo" ? (
            <div className="page-shell page-shell-compact">
              <div
                data-testid="runtime-mode-banner"
                className="glass-panel-soft rounded-2xl border border-[var(--color-warning-soft)] px-4 py-3 text-sm text-[var(--color-warning)]"
              >
                Demo mode is active. Local demo data and local AI fallback are enabled intentionally.
              </div>
            </div>
          ) : null}

          <main className="workspace-canvas">{children}</main>
        </div>
      </div>

      {captureStatus ? (
        <div
          aria-live="polite"
          data-testid="draft-notice"
          className={`fixed left-1/2 top-24 z-40 w-[min(92vw,30rem)] -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-sm font-medium ${
            captureStatus.tone === "error"
              ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)] shadow-[var(--shadow-md)]"
              : captureStatus.tone === "warning"
                ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)] shadow-[var(--shadow-md)]"
                : "glass-chrome text-[var(--color-text)]"
          }`}
        >
          {captureStatus.message}
        </div>
      ) : null}

      <nav
        aria-label="Mobile primary"
        data-testid="mobile-dock"
        className="mobile-dock glass-chrome rounded-3xl px-2 py-2 lg:hidden"
      >
        <div className="grid grid-cols-4 gap-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-center text-caption font-medium transition ${
                  active ? "bg-[var(--color-accent)] text-white" : "text-[var(--color-text-muted)]"
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <AnimatePresence>
        {captureOpen ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(10,18,24,0.32)] p-3 backdrop-blur-sm sm:items-center"
            data-testid="capture-sheet-backdrop"
            onClick={() => closeCaptureSheet()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="capture-sheet-title"
              aria-describedby="capture-sheet-description"
              data-testid="capture-sheet"
              className="glass-chrome w-full max-w-xl rounded-4xl p-5"
              onClick={(event) => event.stopPropagation()}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 340 }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-5 h-1.5 w-16 rounded-full bg-[rgba(15,26,34,0.12)]" />
                  <p className="text-eyebrow">Quick Intake</p>
                  <h2 id="capture-sheet-title" className="mt-2 text-2xl font-semibold">
                    Add business evidence
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => closeCaptureSheet()}
                  data-testid="capture-close"
                  className="rounded-xl bg-white/72 px-3 py-2 text-sm font-medium text-[var(--color-text-muted)]"
                >
                  Close
                </button>
              </div>
              <p id="capture-sheet-description" className="mt-2 text-sm text-[var(--color-text-muted)]">
                Capture starts locally first so the UI stays responsive. The result tells you whether the draft was
                stored persistently or only for this tab.
              </p>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {draftModes.map((mode, index) => (
                  <button
                    key={mode.key}
                    ref={index === 0 ? firstDraftActionRef : undefined}
                    type="button"
                    data-testid={`capture-mode-${mode.key}`}
                    onClick={() => void createDraft(mode)}
                    className="glass-panel rounded-xl px-4 py-4 text-left"
                  >
                    <p className="text-sm font-semibold text-[var(--color-text)]">{mode.label}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Queue locally, then enrich with AI and rules.
                    </p>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
