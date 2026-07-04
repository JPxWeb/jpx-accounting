"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useScrollDirection } from "../hooks/use-scroll-direction";
import type { DraftQueueSaveResult } from "../lib/draft-queue-core";
import { useDialogFocusTrap } from "../lib/focus-trap";
import { CAPTURE_ACCEPT, captureFiles } from "../lib/promotion";
import { formatRuntimeModeLabel } from "../lib/presentation";
import { webRuntimeConfig } from "../lib/runtime-config";
import { CommandPalette } from "./command-palette";
import { useWorkspaceProfile } from "./providers/workspace-profile-provider";
import { ThemeToggle } from "./theme-toggle";
import { AdvisorIcon, BooksIcon, CaptureIcon, ControlIcon, InboxIcon, ReportsIcon, SparkIcon } from "./ui/icons";
import { StatusBadge } from "./ui/status-badge";

const navigation = [
  { href: "/today", key: "today", icon: InboxIcon },
  { href: "/capture", key: "capture", icon: CaptureIcon },
  { href: "/books", key: "books", icon: BooksIcon },
  { href: "/reports", key: "reports", icon: ReportsIcon },
  { href: "/settings", key: "settings", icon: ControlIcon },
] as const;

// Rail-only: the Advisor entry lives in the desktop rail, not the 5-tab mobile dock.
const advisorNavItem = { href: "/assistant", key: "advisor", icon: AdvisorIcon } as const;
const railNavigation = [...navigation, advisorNavItem] as const;

const draftModeKeys = ["camera", "upload", "paste", "share"] as const;

type CaptureStatus = {
  tone: "success" | "warning" | "error";
  message: string;
};

export function AppShell({ children, digest }: { children: ReactNode; digest?: ReactNode }) {
  const t = useTranslations("shell");
  const tPromotion = useTranslations("capture.promotion");
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const barsHidden = useScrollDirection();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus | null>(null);
  const { locale } = useWorkspaceProfile();
  const timestamp = useMemo(() => new Intl.DateTimeFormat(locale).format(new Date()), [locale]);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstDraftActionRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const sheetCameraInputRef = useRef<HTMLInputElement | null>(null);
  const sheetFileInputRef = useRef<HTMLInputElement | null>(null);
  const runtimeModeLabel = formatRuntimeModeLabel(webRuntimeConfig.runtimeMode);
  const activeNavItem = useMemo(
    () => railNavigation.find((item) => pathname.startsWith(item.href)) ?? navigation[0]!,
    [pathname],
  );

  const draftModes = draftModeKeys.map((key) => ({
    key,
    label: t(`draftModes.${key}.label`),
    hint: t(`draftModes.${key}.hint`),
  }));

  function buildCaptureStatusMessage(modeLabel: string, result: DraftQueueSaveResult): CaptureStatus {
    if (result.storage === "indexeddb") {
      return { tone: "success", message: t("captureStatus.indexeddb", { mode: modeLabel }) };
    }

    if (result.storage === "session") {
      return { tone: "warning", message: t("captureStatus.session", { mode: modeLabel }) };
    }

    return { tone: "warning", message: t("captureStatus.memory", { mode: modeLabel }) };
  }

  const closeCaptureSheet = useCallback(() => {
    setCaptureOpen(false);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  useDialogFocusTrap(dialogRef, captureOpen, closeCaptureSheet, firstDraftActionRef);

  useEffect(() => {
    function handleGlobalKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    document.addEventListener("keydown", handleGlobalKey);
    return () => document.removeEventListener("keydown", handleGlobalKey);
  }, []);

  useEffect(() => {
    if (!captureStatus) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setCaptureStatus(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [captureStatus]);

  function handleCaptureMode(mode: { key: (typeof draftModeKeys)[number]; label: string }) {
    if (mode.key === "camera") {
      sheetCameraInputRef.current?.click();
      return;
    }
    if (mode.key === "upload") {
      sheetFileInputRef.current?.click();
      return;
    }
    // Paste and share cannot be initiated from a button: paste needs Ctrl+V/Cmd+V on the
    // capture page, share arrives through the OS share menu. The sheet points at them.
    setCaptureStatus({
      tone: "success",
      message: mode.key === "paste" ? t("captureSheet.pasteHint") : t("captureSheet.shareHint"),
    });
    closeCaptureSheet();
  }

  async function handleSheetFiles(mode: { key: string; label: string }, list: FileList | null) {
    const files = [...(list ?? [])];
    if (files.length === 0) {
      return;
    }

    try {
      // Same pipeline as the capture page: local draft first (status message tells the
      // storage tier), then fire-and-forget promotion into ledger evidence.
      const outcome = await captureFiles(files, mode.key, {
        queryClient,
        onPromoted: (draft) => toast.success(tPromotion("promoted", { name: draft.title })),
        onPromoteError: (draft) => toast.error(tPromotion("promoteError", { name: draft.title })),
      });

      for (const rejection of outcome.rejected) {
        toast.error(
          tPromotion(rejection.reason === "size" ? "rejectedSize" : "rejectedType", { name: rejection.file.name }),
        );
      }

      const lastSaved = outcome.saved.at(-1);
      if (lastSaved) {
        setCaptureStatus(buildCaptureStatusMessage(mode.label, lastSaved.save));
        closeCaptureSheet();
      }
    } catch {
      setCaptureStatus({
        tone: "error",
        message: t("captureStatus.error", { mode: mode.label }),
      });
    }
  }

  function openCaptureSheet(event: MouseEvent<HTMLButtonElement>) {
    returnFocusRef.current = event.currentTarget;
    setCaptureOpen(true);
  }

  return (
    <div className="app-shell">
      <div
        className="pointer-events-none fixed inset-0"
        style={{ background: "radial-gradient(circle at top, var(--page-glow-light), transparent 45%)" }}
      />
      <div className="shell-layout">
        <aside className="shell-rail" data-testid="desktop-navigation">
          <div className="shell-rail-inner">
            <section className="glass-chrome rounded-xl px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-eyebrow">{t("brand")}</p>
                <StatusBadge
                  status={runtimeModeLabel}
                  variant={webRuntimeConfig.runtimeMode === "demo" ? "warning" : "accent"}
                />
              </div>
              <h1 className="mt-3 text-2xl font-semibold leading-tight">{t("marketing.headline")}</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("marketing.subheadline")}</p>
              {webRuntimeConfig.runtimeMode === "demo" ? (
                <p className="mt-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
                  {t("marketing.demoNotice")}
                </p>
              ) : null}
            </section>

            <nav
              className="glass-panel rounded-xl p-3"
              aria-label={t("primaryNavAria")}
              data-testid="desktop-navigation-links"
            >
              {railNavigation.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-start gap-3 rounded-lg px-4 py-4 transition ${
                      active ? "bg-primary text-white shadow-sm" : "text-foreground hover:bg-surface-muted"
                    }`}
                  >
                    <span
                      className={`mt-0.5 rounded-lg p-2 ${
                        active ? "bg-white/16 text-white" : "bg-surface-muted text-muted-foreground"
                      }`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{t(`nav.${item.key}.label`)}</span>
                      <span className={`mt-1 block text-xs ${active ? "text-white/90" : "text-muted-foreground"}`}>
                        {t(`nav.${item.key}.summary`)}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </nav>

            {digest ? <div className="hidden lg:block">{digest}</div> : null}

            <section className="glass-panel rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-eyebrow">{t("captureLane.eyebrow")}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{t("captureLane.description")}</p>
                </div>
                <StatusBadge status={t("captureLane.badge")} variant="accent" />
              </div>
              <button
                type="button"
                onClick={openCaptureSheet}
                data-testid="capture-open-desktop"
                className="capture-button-desktop mt-4 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 py-4 text-sm font-semibold text-white shadow-md"
              >
                <CaptureIcon className="size-4" />
                {t("captureLane.action")}
              </button>
            </section>

            <section className="glass-panel-soft mt-auto rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <SparkIcon className="size-4 text-primary" />
                  <span className="text-eyebrow">{t("innovation.eyebrow")}</span>
                </div>
                <ThemeToggle />
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("innovation.description")}</p>
            </section>
          </div>
        </aside>

        <div className="shell-main">
          <header
            className="page-shell page-shell-compact shell-topbar"
            data-testid="app-shell-header"
            data-hidden={barsHidden}
          >
            <div className="glass-chrome flex items-center justify-between gap-4 rounded-2xl px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-eyebrow">{t("brand")}</p>
                  <StatusBadge
                    status={runtimeModeLabel}
                    variant={webRuntimeConfig.runtimeMode === "demo" ? "warning" : "accent"}
                    testId="runtime-mode-pill"
                  />
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {t(`nav.${activeNavItem.key}.label`)}
                  </p>
                  <span className="hidden h-1 w-1 rounded-full bg-foreground-soft sm:block" />
                  <p className="hidden truncate text-sm text-muted-foreground sm:block">
                    {t(`nav.${activeNavItem.key}.summary`)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden rounded-lg glass-panel-soft px-3 py-2 text-right text-xs text-muted-foreground sm:block">
                  <div className="font-medium text-foreground">{t("topbar.location")}</div>
                  <div>{timestamp}</div>
                </div>
                <div className="lg:hidden">
                  <ThemeToggle />
                </div>
                <button
                  type="button"
                  onClick={openCaptureSheet}
                  data-testid="capture-open-mobile"
                  aria-label={t("topbar.captureAria")}
                  className="flex size-10 items-center justify-center rounded-lg bg-primary text-white shadow-sm lg:hidden"
                >
                  <CaptureIcon className="size-4" />
                </button>
              </div>
            </div>
          </header>

          {digest ? (
            <details className="page-shell page-shell-compact lg:hidden" data-testid="digest-mobile">
              <summary className="glass-panel-soft cursor-pointer rounded-md px-4 py-3 text-sm font-medium">
                {t("digest.mobileSummary")}
              </summary>
              <div className="mt-2">{digest}</div>
            </details>
          ) : null}

          {webRuntimeConfig.runtimeMode === "demo" ? (
            <div className="page-shell page-shell-compact">
              <div
                data-testid="runtime-mode-banner"
                className="glass-panel-soft rounded-lg border border-warning-soft px-4 py-3 text-sm text-warning"
              >
                {t("demoBanner")}
              </div>
            </div>
          ) : null}

          <main id="main-content" className="workspace-canvas">
            {children}
          </main>
        </div>
      </div>

      {captureStatus ? (
        <div
          aria-live="polite"
          data-testid="draft-notice"
          className={`fixed left-1/2 top-24 z-40 w-[min(92vw,30rem)] -translate-x-1/2 rounded-lg px-4 py-3 text-center text-sm font-medium ${
            captureStatus.tone === "error"
              ? "bg-danger-soft text-danger shadow-md"
              : captureStatus.tone === "warning"
                ? "bg-warning-soft text-warning shadow-md"
                : "glass-chrome text-foreground"
          }`}
        >
          {captureStatus.message}
        </div>
      ) : null}

      <nav
        aria-label={t("mobileNavAria")}
        data-testid="mobile-dock"
        className="mobile-dock glass-chrome rounded-2xl px-2 py-2 lg:hidden"
        data-hidden={barsHidden}
      >
        <div className="grid grid-cols-5 gap-2">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={`${t(`nav.${item.key}.label`)} — ${t(`nav.${item.key}.summary`)}`}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 rounded-lg px-2 py-3 text-center text-caption font-medium transition ${
                  active ? "bg-primary text-white" : "text-muted-foreground"
                }`}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {t(`nav.${item.key}.label`)}
              </Link>
            );
          })}
        </div>
      </nav>

      <AnimatePresence>
        {captureOpen ? (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-3 backdrop-blur-sm sm:items-center"
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
              className="glass-chrome w-full max-w-xl rounded-2xl p-5"
              onClick={(event) => event.stopPropagation()}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 340 }}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-5 h-1.5 w-16 rounded-full bg-border-strong" />
                  <p className="text-eyebrow">{t("captureSheet.eyebrow")}</p>
                  <h2 id="capture-sheet-title" className="mt-2 text-2xl font-semibold">
                    {t("captureSheet.title")}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => closeCaptureSheet()}
                  aria-label={t("captureSheet.closeAria")}
                  data-testid="capture-close"
                  className="rounded-md bg-surface px-3 py-2 text-sm font-medium text-muted-foreground"
                >
                  {t("captureSheet.close")}
                </button>
              </div>
              <p id="capture-sheet-description" className="mt-2 text-sm text-muted-foreground">
                {t("captureSheet.description")}
              </p>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {draftModes.map((mode, index) => (
                  <button
                    key={mode.key}
                    ref={index === 0 ? firstDraftActionRef : undefined}
                    type="button"
                    data-testid={`capture-mode-${mode.key}`}
                    onClick={() => handleCaptureMode(mode)}
                    className="glass-panel rounded-lg px-4 py-4 text-left"
                  >
                    <p className="text-sm font-semibold text-foreground">{mode.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{mode.hint}</p>
                  </button>
                ))}
              </div>
              <input
                ref={sheetCameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                data-testid="capture-sheet-camera-input"
                onChange={(event) => {
                  const mode = draftModes.find((entry) => entry.key === "camera");
                  if (mode) void handleSheetFiles(mode, event.target.files);
                  event.target.value = "";
                }}
              />
              <input
                ref={sheetFileInputRef}
                type="file"
                multiple
                accept={CAPTURE_ACCEPT}
                className="hidden"
                data-testid="capture-sheet-file-input"
                onChange={(event) => {
                  const mode = draftModes.find((entry) => entry.key === "upload");
                  if (mode) void handleSheetFiles(mode, event.target.files);
                  event.target.value = "";
                }}
              />
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
