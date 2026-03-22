import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Manrope, IBM_Plex_Mono } from "next/font/google";

import { QueryProvider } from "../components/providers/query-provider";
import { ServiceWorkerRegistrar } from "../components/pwa/service-worker-registrar";
import { APP_THEME_COLOR } from "../lib/presentation";
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
    <html lang="sv" className={`${manrope.variable} ${plexMono.variable}`}>
      <body>
        <QueryProvider>
          <ServiceWorkerRegistrar />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
