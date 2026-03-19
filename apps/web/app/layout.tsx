import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../components/app-shell";
import { QueryProvider } from "../components/providers/query-provider";
import { ServiceWorkerRegistrar } from "../components/pwa/service-worker-registrar";
import "./globals.css";

export const metadata: Metadata = {
  title: "JPX Accounting",
  description: "Mobile-first AI accounting workspace for Swedish bookkeeping and advisory.",
  applicationName: "JPX Accounting",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>
          <ServiceWorkerRegistrar />
          <AppShell>{children}</AppShell>
        </QueryProvider>
      </body>
    </html>
  );
}

