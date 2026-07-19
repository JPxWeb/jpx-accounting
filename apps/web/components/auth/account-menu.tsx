"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";

import { signOutAndClearLocalData, useAuthSession } from "../../lib/auth";

/**
 * Topbar account affordance (WS-C R12). Renders NOTHING until auth is
 * configured AND the persisted session has resolved, so the demo shell (no
 * NEXT_PUBLIC_SUPABASE_* env) stays byte-identical — E2E and the visual
 * baselines depend on that. Signed out → link to /login; signed in → menu with
 * the account email and sign-out.
 *
 * Overlay follows the shell convention (CLAUDE.md): controlled-open state with
 * an invisible backdrop button + Escape to close — never `<details>`.
 */
export function AccountMenu() {
  const t = useTranslations("shell.account");
  const auth = useAuthSession();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  if (auth.status === "disabled" || auth.status === "loading") {
    return null;
  }

  if (auth.status === "signed-out") {
    return (
      <Link
        href="/login"
        data-testid="account-sign-in"
        className="inline-flex rounded-lg glass-panel-soft px-3 py-2 text-xs font-medium text-muted-foreground"
      >
        {t("signIn")}
      </Link>
    );
  }

  const email = auth.session.user.email ?? auth.session.user.id;

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    await signOutAndClearLocalData();
    // Hard navigation: React Query holds ledger snapshots in memory — a client
    // route transition would keep serving them after the session ended.
    window.location.assign("/login");
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("menuAria")}
        data-testid="account-menu-open"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex max-w-40 items-center rounded-lg glass-panel-soft px-3 py-2 text-xs font-medium text-muted-foreground"
      >
        <span className="truncate">{email}</span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label={t("closeMenuAria")}
            data-testid="account-menu-backdrop"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            data-testid="account-menu"
            className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl glass-chrome p-4 shadow-md"
          >
            <p className="text-eyebrow">{t("signedInAs")}</p>
            <p className="mt-1 truncate text-sm font-semibold text-foreground" data-testid="account-menu-email">
              {email}
            </p>
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleSignOut()}
              disabled={pending}
              data-testid="account-sign-out"
              className="mt-4 w-full rounded-lg bg-surface px-3 py-2 text-left text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
            >
              {pending ? t("signingOut") : t("signOut")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
