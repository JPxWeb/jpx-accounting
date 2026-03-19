"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { saveCaptureDraft } from "../lib/draft-queue";
import { AdvisorIcon, CaptureIcon, ControlIcon, InboxIcon, ReportsIcon, SparkIcon } from "./ui/icons";

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

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const timestamp = useMemo(() => new Date().toLocaleDateString("sv-SE"), []);
  const activeNavItem = useMemo(
    () => navigation.find((item) => (item.href === "/" ? pathname === item.href : pathname.startsWith(item.href))) ?? navigation[0]!,
    [pathname],
  );

  useEffect(() => {
    if (!draftNotice) return undefined;

    const timeoutId = window.setTimeout(() => setDraftNotice(null), 2500);
    return () => window.clearTimeout(timeoutId);
  }, [draftNotice]);

  async function createDraft(mode: { key: string; label: string }) {
    await saveCaptureDraft({
      id: crypto.randomUUID(),
      mode: mode.key,
      title: `${mode.label} draft`,
      createdAt: new Date().toISOString(),
    });
    // Capture starts locally so the UI stays responsive while the real upload pipeline is still being built.
    setDraftNotice(`${mode.label} draft saved locally.`);
    setCaptureOpen(false);
  }

  return (
    <div className="app-shell">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.42),_transparent_45%)]" />
      <div className="shell-layout">
        <aside className="shell-rail" data-testid="desktop-navigation">
          <div className="shell-rail-inner">
            <section className="glass-chrome rounded-[32px] px-5 py-5">
              <p className="text-[0.68rem] uppercase tracking-[0.28em] text-[var(--color-text-muted)]">JPX Accounting</p>
              <h1 className="mt-3 text-2xl font-semibold leading-tight">Trustworthy AI bookkeeping for Sweden-first teams.</h1>
              <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                Compliance-critical flows stay deterministic. AI guides, cites, and accelerates the review surface.
              </p>
            </section>

            <nav className="glass-panel rounded-[32px] p-3" aria-label="Primary" data-testid="desktop-navigation-links">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-start gap-3 rounded-[24px] px-4 py-4 transition ${
                      active
                        ? "bg-[var(--color-accent)] text-white shadow-[0_18px_38px_rgba(10,143,130,0.22)]"
                        : "text-[var(--color-text)] hover:bg-[rgba(255,255,255,0.72)]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 rounded-[18px] p-2 ${
                        active ? "bg-white/16 text-white" : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                      }`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{item.label}</span>
                      <span className={`mt-1 block text-xs ${active ? "text-white/78" : "text-[var(--color-text-muted)]"}`}>
                        {item.summary}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </nav>

            <section className="glass-panel rounded-[32px] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-text-muted)]">Capture lane</p>
                  <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                    Camera, paste, upload, and share all land in the same review-ready queue.
                  </p>
                </div>
                <span className="rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--color-accent)]">
                  Mobile-first
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCaptureOpen((value) => !value)}
                data-testid="capture-open-desktop"
                className="capture-button-desktop accent-ring mt-4 w-full items-center justify-center gap-2 rounded-[22px] bg-[var(--color-accent)] px-5 py-4 text-sm font-semibold text-white"
              >
                <CaptureIcon className="size-4" />
                Capture Evidence
              </button>
            </section>

            <section className="glass-panel-soft mt-auto rounded-[32px] p-4">
              <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                <SparkIcon className="size-4 text-[var(--color-accent)]" />
                <span className="text-xs uppercase tracking-[0.22em]">Innovation track</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--color-text-muted)]">
                Voice capture, simulations, and close copilot are isolated from posting authority until they earn trust.
              </p>
            </section>
          </div>
        </aside>

        <div className="shell-main">
          <header className="page-shell page-shell-compact shell-topbar" data-testid="app-shell-header">
            <div className="glass-chrome flex items-center justify-between gap-4 rounded-[28px] px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="text-[0.68rem] uppercase tracking-[0.28em] text-[var(--color-text-muted)]">JPX Accounting</p>
                <div className="mt-1 flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-semibold text-[var(--color-text)]">{activeNavItem.label}</p>
                  <span className="hidden h-1 w-1 rounded-full bg-[var(--color-text-soft)] sm:block" />
                  <p className="hidden truncate text-sm text-[var(--color-text-muted)] sm:block">{activeNavItem.summary}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden rounded-full bg-white/72 px-3 py-2 text-right text-xs text-[var(--color-text-muted)] sm:block">
                  <div className="font-medium text-[var(--color-text)]">Sweden Central / Stockholm</div>
                  <div>{timestamp}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setCaptureOpen((value) => !value)}
                  data-testid="capture-open-mobile"
                  className="capture-button-mobile accent-ring flex items-center gap-2 rounded-full bg-[var(--color-accent)] px-5 py-4 text-sm font-semibold text-white shadow-[0_24px_45px_rgba(10,143,130,0.3)] lg:hidden"
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

      {draftNotice ? (
        <div
          aria-live="polite"
          data-testid="draft-notice"
          className="glass-chrome fixed left-1/2 top-24 z-40 w-[min(92vw,24rem)] -translate-x-1/2 rounded-full px-4 py-3 text-center text-sm font-medium text-[var(--color-text)]"
        >
          {draftNotice}
        </div>
      ) : null}

      <nav
        aria-label="Mobile primary"
        data-testid="mobile-dock"
        className="mobile-dock glass-chrome rounded-[30px] px-2 py-2 lg:hidden"
      >
        <div className="grid grid-cols-4 gap-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-1 rounded-[22px] px-2 py-2.5 text-center text-[0.68rem] font-medium transition ${
                  active
                    ? "bg-[var(--color-accent)] text-white shadow-[0_18px_30px_rgba(10,143,130,0.22)]"
                    : "text-[var(--color-text-muted)]"
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {captureOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(10,18,24,0.24)] p-3"
          data-testid="capture-sheet-backdrop"
          onClick={() => setCaptureOpen(false)}
        >
          <div
            data-testid="capture-sheet"
            className="glass-chrome w-full max-w-xl rounded-[32px] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-5 h-1.5 w-16 rounded-full bg-[rgba(15,26,34,0.12)]" />
            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[var(--color-text-muted)]">Quick Intake</p>
            <h2 className="mt-2 text-2xl font-semibold">Add business evidence</h2>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              The draft queue is stored locally first so capture feels instant on mobile, even before upload pipelines finish.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {draftModes.map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  data-testid={`capture-mode-${mode.key}`}
                  onClick={() => void createDraft(mode)}
                  className="glass-panel rounded-[24px] px-4 py-4 text-left"
                >
                  <p className="text-sm font-semibold text-[var(--color-text)]">{mode.label}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">Queue locally, then enrich with AI and rules.</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
