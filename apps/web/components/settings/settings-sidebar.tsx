"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  { href: "/settings/company", label: "Company" },
  { href: "/settings/fiscal-year", label: "Fiscal year & VAT" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/team", label: "Team & roles" },
  { href: "/settings/ai-posture", label: "AI posture" },
  { href: "/settings/retention", label: "Retention" },
  { href: "/settings/compliance", label: "Compliance watch" },
  { href: "/settings/about", label: "About this build" },
];

export function SettingsSidebar() {
  const pathname = usePathname();
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
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
