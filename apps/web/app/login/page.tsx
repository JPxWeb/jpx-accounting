import type { Metadata } from "next";

import { LoginScreen } from "../../components/auth/login-screen";

export const metadata: Metadata = {
  title: "Sign in — JPX Accounting",
};

/**
 * Standalone auth route (WS-C R12) — outside the `(shell)` group on purpose:
 * no tab chrome, no capture pill, just the focused sign-in/sign-up card.
 * `id="main-content"` keeps the root layout's skip-to-content link functional.
 */
export default function LoginPage() {
  return (
    <main id="main-content" className="flex min-h-dvh items-center justify-center px-4 py-10">
      <LoginScreen />
    </main>
  );
}
