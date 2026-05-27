import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "../components/providers/query-provider";
import { ServiceWorkerRegistrar } from "../components/pwa/service-worker-registrar";
import { APP_THEME_COLOR } from "../lib/presentation";
import { cn } from "../lib/utils";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "JPX Accounting",
  description: "Mobile-first AI accounting workspace for Swedish bookkeeping and advisory.",
  applicationName: "JPX Accounting",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: APP_THEME_COLOR,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv" className={cn(manrope.variable, plexMono.variable, "font-sans")}>
      <body>
        <a
          href="#main-content"
          className="fixed left-2 top-2 z-[100] -translate-y-full rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition focus:translate-y-0"
        >
          Skip to content
        </a>
        <QueryProvider>
          <NuqsAdapter>
            <ServiceWorkerRegistrar />
            {children}
          </NuqsAdapter>
        </QueryProvider>
        <Toaster />
      </body>
    </html>
  );
}
