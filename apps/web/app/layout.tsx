import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "../components/providers/query-provider";
import { WorkspaceProfileProvider } from "../components/providers/workspace-profile-provider";
import { ServiceWorkerRegistrar } from "../components/pwa/service-worker-registrar";
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

const APP_DESCRIPTION =
  "AI advisory accounting for European small businesses — Sweden-first depth (BAS, moms, Bokföringslagen), human-approved postings, and an append-only verifiable ledger.";

export const metadata: Metadata = {
  title: "JPX Accounting",
  description: APP_DESCRIPTION,
  applicationName: "JPX Accounting",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "JPX Accounting",
    description: APP_DESCRIPTION,
    siteName: "JPX Accounting",
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "JPX Accounting" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "JPX Accounting",
    description: APP_DESCRIPTION,
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  // color-scheme is owned by ui-tokens (:root light, .dark dark) — pinning it
  // here would fight the class-based theme switch. themeColor tracks the page
  // background per scheme so browser chrome matches on both.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e9eff2" },
    { media: "(prefers-color-scheme: dark)", color: "#101319" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations("common");

  return (
    <html lang={locale} suppressHydrationWarning className={cn(manrope.variable, plexMono.variable, "font-sans")}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <NextIntlClientProvider>
            <a
              href="#main-content"
              className="fixed left-2 top-2 z-[100] -translate-y-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition focus:translate-y-0"
            >
              {t("skipToContent")}
            </a>
            <QueryProvider>
              <WorkspaceProfileProvider>
                <NuqsAdapter>
                  <ServiceWorkerRegistrar />
                  {children}
                </NuqsAdapter>
              </WorkspaceProfileProvider>
            </QueryProvider>
            <Toaster />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
