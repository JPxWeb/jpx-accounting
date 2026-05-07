"use client";

import type { ChangeEvent, MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";

import { CommandPalette } from "./command-palette";
import { apiClient } from "../lib/client";
import { saveCaptureDraft } from "../lib/draft-queue";
import type { DraftQueueSaveResult } from "../lib/draft-queue-core";
import { useDialogFocusTrap } from "../lib/focus-trap";
import { formatRuntimeModeLabel } from "../lib/presentation";
import { webRuntimeConfig } from "../lib/runtime-config";
import {
  AdvisorIcon,
  BellIcon,
  CaptureIcon,
  ControlIcon,
  InboxIcon,
  ReportsIcon,
  SearchIcon,
  UserIcon,
} from "./ui/icons";
import { StatusBadge } from "./ui/status-badge";

const navigation = [
  { href: "/", label: "Inbox", summary: "Evidence and review queue", icon: InboxIcon },
  { href: "/reports", label: "Reports", summary: "Journal, balances, and VAT", icon: ReportsIcon },
  { href: "/assistant", label: "Advisor", summary: "Grounded finance guidance", icon: AdvisorIcon },
  { href: "/settings", label: "Settings", summary: "Status, posture, and account", icon: ControlIcon },
];

const draftModes = [
  { key: "camera", label: "Camera" },
  { key: "upload", label: "Upload" },
  { key: "paste", label: "Paste" },
  { key: "share", label: "Share" },
];

const draftModesMoreFilter = draftModes.filter((m) => m.key !== "upload");

const ACCOUNT_DISPLAY_NAME = "Demo user";
const ACCOUNT_WORKSPACE_LABEL = "workspace_main";

type CaptureStatus = {
  tone: "success" | "warning" | "error";
  message: string;
};

function isPrimaryNavActive(href: string, pathname: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

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

function AccountMenuPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-lg)]">
      <p className="text-sm font-semibold text-[var(--color-text)]">{ACCOUNT_DISPLAY_NAME}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">{ACCOUNT_WORKSPACE_LABEL}</p>
      <a
        href="https://github.com"
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-block text-sm font-medium text-[var(--color-accent)]"
        onClick={onClose}
      >
        Documentation
      </a>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">Workspace switcher coming soon.</p>
    </div>
  );
}

function AccountMenu() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="relative lg:hidden">
      <button
        type="button"
        aria-label="Account menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded-xl p-2 hover:bg-[var(--color-surface-muted)]"
      >
        <UserIcon className="size-5 text-[var(--color-text-muted)]" />
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label="Close account menu"
            className="fixed inset-0 z-30 cursor-default bg-transparent"
            onClick={close}
          />
          <AccountMenuPanel onClose={close} />
        </>
      ) : null}
    </div>
  );
}

function AccountRailCard() {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="glass-panel-soft mt-auto rounded-4xl p-4" data-testid="account-menu-rail">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-sm font-semibold text-[var(--color-accent)]">
          <UserIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--color-text)]">{ACCOUNT_DISPLAY_NAME}</p>
          <p className="truncate text-xs text-[var(--color-text-muted)]">{ACCOUNT_WORKSPACE_LABEL}</p>
        </div>
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 text-eyebrow"
      >
        Account & workspace
      </button>
      {expanded ? (
        <div className="mt-3 space-y-2 text-sm text-[var(--color-text-muted)]">
          <p>Workspace switcher will land here for multi-entity teams.</p>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="inline-flex font-medium text-[var(--color-accent)]"
          >
            Documentation
          </a>
          <button
            type="button"
            disabled
            className="block w-full rounded-xl px-0 py-1 text-left text-[var(--color-text-soft)]"
          >
            Sign out (soon)
          </button>
        </div>
      ) : null}
    </section>
  );
}

function NotificationMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
    staleTime: 60_000,
  });
  const alerts = data?.alerts ?? [];

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="notifications-trigger"
        aria-label="Notifications"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
        className="relative rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
      >
        <BellIcon className="size-5" />
        {alerts.length > 0 ? (
          <span className="absolute right-1 top-1 block h-2 w-2 rounded-full bg-[var(--color-danger)] ring-2 ring-white" />
        ) : null}
      </button>
      {menuOpen ? (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-30 cursor-default bg-transparent"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 top-full z-40 mt-2 w-[min(92vw,18rem)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-lg)]">
            {alerts.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-[var(--color-text-muted)]">No alerts right now.</p>
            ) : (
              <ul className="max-h-72 space-y-1 overflow-y-auto">
                {alerts.map((alertItem) => (
                  <li key={alertItem.id}>
                    <Link
                      href="/reports#compliance-watch"
                      className="block rounded-xl px-3 py-2 text-left hover:bg-[var(--color-surface-muted)]"
                      onClick={() => setMenuOpen(false)}
                    >
                      <p className="text-sm font-medium text-[var(--color-text)]">{alertItem.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text-muted)]">
                        {alertItem.impactSummary}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstDraftActionRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const runtimeModeLabel = formatRuntimeModeLabel(webRuntimeConfig.runtimeMode);
  const activeNavItem = useMemo(
    () => navigation.find((item) => isPrimaryNavActive(item.href, pathname)) ?? navigation[0]!,
    [pathname],
  );

  const closeCaptureSheet = useCallback(() => {
    setCaptureOpen(false);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  const closeCommandPalette = useCallback(() => setCommandOpen(false), []);
  const openCommandPalette = useCallback(() => setCommandOpen(true), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!captureStatus) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCaptureStatus(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [captureStatus]);

  useDialogFocusTrap(dialogRef, captureOpen, closeCaptureSheet, firstDraftActionRef);

  async function createDraft(mode: (typeof draftModes)[number]) {
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

  async function createDraftFromFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const result = await saveCaptureDraft({
        id: crypto.randomUUID(),
        mode: "upload",
        title: file.name,
        createdAt: new Date().toISOString(),
      });
      setCaptureStatus(buildCaptureStatusMessage("Upload", result));
      closeCaptureSheet();
    } catch {
      setCaptureStatus({
        tone: "error",
        message: "Upload draft could not be saved locally. Check browser storage permissions and try again.",
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
                const active = isPrimaryNavActive(item.href, pathname);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-start gap-3 rounded-2xl px-4 py-4 transition ${
                      active
                        ? "bg-[var(--color-accent)] text-white! shadow-[var(--shadow-sm)]"
                        : "text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.72)]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 rounded-xl p-2 ${
                        active
                          ? "bg-white/16 text-white!"
                          : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                      }`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${active ? "text-white!" : ""}`}>{item.label}</span>
                      <span
                        className={`mt-1 block text-xs ${active ? "text-white/95!" : "text-[var(--color-text-muted)]"}`}
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
                Capture
              </button>
            </section>

            <AccountRailCard />
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
              <div className="flex items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={openCommandPalette}
                  data-testid="command-palette-open"
                  aria-label="Open search"
                  className="rounded-xl p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                >
                  <SearchIcon className="size-5" />
                </button>
                <NotificationMenu />
                <AccountMenu />
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
            const active = isPrimaryNavActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2.5 text-center text-caption font-medium transition ${
                  active ? "bg-[var(--color-accent)] text-white!" : "text-[var(--color-text-muted)]"
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
                  <p className="text-eyebrow">Capture</p>
                  <h2 id="capture-sheet-title" className="mt-2 text-2xl font-semibold">
                    Capture evidence
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
              <input
                ref={fileInputRef}
                type="file"
                className="sr-only"
                accept="image/*,application/pdf"
                tabIndex={-1}
                aria-hidden
                onChange={(event) => void createDraftFromFileSelection(event)}
              />
              <button
                ref={firstDraftActionRef}
                type="button"
                data-testid="capture-evidence-primary"
                onClick={() => fileInputRef.current?.click()}
                className="mt-5 w-full rounded-xl bg-[var(--color-accent)] px-5 py-4 text-sm font-semibold text-white shadow-[var(--shadow-md)]"
              >
                Capture evidence
              </button>
              <details className="mt-4 rounded-2xl bg-[var(--color-surface-muted)] px-4 py-3">
                <summary className="cursor-pointer text-eyebrow marker:content-none">More capture options</summary>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {draftModesMoreFilter.map((mode) => (
                    <button
                      key={mode.key}
                      type="button"
                      data-testid={`capture-mode-${mode.key}`}
                      onClick={() => void createDraft(mode)}
                      className="glass-panel rounded-xl px-4 py-4 text-left"
                    >
                      <p className="text-sm font-semibold text-[var(--color-text)]">{mode.label}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Save a local draft to the queue.</p>
                    </button>
                  ))}
                </div>
              </details>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <CommandPalette open={commandOpen} onClose={closeCommandPalette} />
    </div>
  );
}
