import type { ReactNode } from "react";

import { AppShell } from "../../components/app-shell";
import { OnboardingShell } from "../../components/onboarding/onboarding-shell";

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <OnboardingShell>
      <AppShell>{children}</AppShell>
    </OnboardingShell>
  );
}
