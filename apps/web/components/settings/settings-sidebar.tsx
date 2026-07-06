"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const sections = [
  { href: "/settings/company", labelKey: "company" },
  { href: "/settings/fiscal-year", labelKey: "fiscalYear" },
  { href: "/settings/integrations", labelKey: "integrations" },
  { href: "/settings/team", labelKey: "team" },
  { href: "/settings/ai-posture", labelKey: "aiPosture" },
  { href: "/settings/retention", labelKey: "retention" },
  { href: "/settings/compliance", labelKey: "compliance" },
  { href: "/settings/about", labelKey: "about" },
] as const;

export function SettingsSidebar() {
  const pathname = usePathname();
  const t = useTranslations("settings.sidebar");

  return (
    <nav data-testid="settings-sidebar" className="glass-panel rounded-xl p-2 lg:w-64">
      <ul className="space-y-1">
        {sections.map((section) => {
          const active = pathname.startsWith(section.href);
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-md px-3 py-2 text-sm ${
                  active ? "bg-primary text-white" : "text-foreground hover:bg-surface-muted"
                }`}
              >
                {t(section.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
