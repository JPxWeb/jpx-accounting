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

const APP_DESCRIPTION =
  "AI advisory accounting for European small businesses — deadlines, insights, and compliant bookkeeping.";

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
  colorScheme: "light",
  themeColor: APP_THEME_COLOR,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv" className={cn(manrope.variable, plexMono.variable, "font-sans")}>
      <body>
        <a
          href="#main-content"
          className="fixed left-2 top-2 z-[100] -translate-y-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition focus:translate-y-0"
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
