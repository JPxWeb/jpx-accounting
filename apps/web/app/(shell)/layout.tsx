import type { ReactNode } from "react";

import { AppShell } from "../../components/app-shell";

export default function ShellLayout({ children, digest }: { children: ReactNode; digest: ReactNode }) {
  return <AppShell digest={digest}>{children}</AppShell>;
}
