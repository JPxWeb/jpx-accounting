"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import {
  isAuthConfigured,
  signInWithPassword,
  signOutAndClearLocalData,
  signUpWithPassword,
  useAuthSession,
} from "../../lib/auth";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScreenHeader } from "../ui/screen-header";
import { UnavailableState } from "../ui/unavailable-state";

type LoginMode = "sign-in" | "sign-up";

/**
 * Email+password sign-in / sign-up / sign-out (WS-C R12 auth MVP).
 *
 * Honest limitations, by design: email confirmation and password recovery
 * follow the Supabase project's hosted defaults (confirmation emails link to
 * Supabase's flow — there is no in-app confirm/resend/reset UX yet), and no
 * OAuth providers are offered. Provider error messages are surfaced verbatim
 * under a translated headline instead of being remapped into guesses.
 *
 * When NEXT_PUBLIC_SUPABASE_* is absent this renders the honest unavailable
 * state — nothing in the demo shell links here in that case.
 */
export function LoginScreen() {
  const t = useTranslations("auth.login");
  const auth = useAuthSession();
  const [mode, setMode] = useState<LoginMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!isAuthConfigured()) {
    return (
      <UnavailableState title={t("notConfiguredTitle")} message={t("notConfiguredBody")} testId="login-unavailable" />
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setNotice(null);
    const result =
      mode === "sign-in" ? await signInWithPassword(email, password) : await signUpWithPassword(email, password);
    if (result.error) {
      setPending(false);
      setError(result.error);
      return;
    }
    if (result.needsEmailConfirmation) {
      setPending(false);
      setNotice(t("checkEmail", { email }));
      return;
    }
    // Hard navigation on purpose: query caches and module state rebuild under
    // the new session, and every request now carries the bearer token.
    window.location.assign("/today");
  }

  async function handleSignOut() {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await signOutAndClearLocalData();
    if (result.error) {
      setPending(false);
      setError(result.error);
      return;
    }
    window.location.assign("/login");
  }

  if (auth.status === "signed-in") {
    const signedInEmail = auth.session.user.email ?? auth.session.user.id;
    return (
      <div className="mx-auto w-full max-w-md space-y-6">
        <ScreenHeader eyebrow={t("eyebrow")} title={t("signedInTitle")} description={t("signedInBody")} />
        <section className="glass-panel rounded-xl p-5" data-testid="login-signed-in">
          <p className="text-eyebrow">{t("signedInAs")}</p>
          <p className="mt-2 truncate text-sm font-semibold text-foreground" data-testid="login-signed-in-email">
            {signedInEmail}
          </p>
          {error ? (
            <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
              {t("signOutErrorTitle")} {error}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link
              href="/today"
              className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm"
            >
              {t("continueToApp")}
            </Link>
            <Button
              variant="outline"
              onClick={() => void handleSignOut()}
              disabled={pending}
              data-testid="login-sign-out"
            >
              {pending ? t("signingOut") : t("signOut")}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <section className="glass-panel rounded-xl p-5">
        <div className="flex gap-2" role="tablist" aria-label={t("modeSwitcherAria")}>
          <Button
            type="button"
            role="tab"
            aria-selected={mode === "sign-in"}
            variant={mode === "sign-in" ? "default" : "outline"}
            onClick={() => {
              setMode("sign-in");
              setError(null);
              setNotice(null);
            }}
            data-testid="login-mode-sign-in"
          >
            {t("signIn")}
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={mode === "sign-up"}
            variant={mode === "sign-up" ? "default" : "outline"}
            onClick={() => {
              setMode("sign-up");
              setError(null);
              setNotice(null);
            }}
            data-testid="login-mode-sign-up"
          >
            {t("signUp")}
          </Button>
        </div>

        <form className="mt-5 space-y-4" onSubmit={(event) => void handleSubmit(event)} data-testid="login-form">
          <div className="space-y-2">
            <Label htmlFor="login-email">{t("emailLabel")}</Label>
            <Input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="login-email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="login-password">{t("passwordLabel")}</Label>
            <Input
              id="login-password"
              type="password"
              required
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              data-testid="login-password"
            />
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger"
              data-testid="login-error"
            >
              <p className="font-semibold">{mode === "sign-in" ? t("signInErrorTitle") : t("signUpErrorTitle")}</p>
              <p className="mt-1">{error}</p>
            </div>
          ) : null}
          {notice ? (
            <p
              role="status"
              className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"
              data-testid="login-notice"
            >
              {notice}
            </p>
          ) : null}

          <Button type="submit" disabled={pending} className="w-full" data-testid="login-submit">
            {pending
              ? mode === "sign-in"
                ? t("signingIn")
                : t("signingUp")
              : mode === "sign-in"
                ? t("signIn")
                : t("signUp")}
          </Button>
        </form>

        <p className="mt-4 text-xs leading-5 text-muted-foreground">{t("limitationsNote")}</p>
      </section>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/today" className="font-medium underline">
          {t("backToApp")}
        </Link>
      </p>
    </div>
  );
}
