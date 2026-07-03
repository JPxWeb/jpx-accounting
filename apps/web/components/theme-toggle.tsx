"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import * as React from "react";

import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "system", label: "System theme", icon: Monitor },
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
] as const;

function subscribe() {
  return () => {};
}

/**
 * SSR-safe mounted flag — same useSyncExternalStore trick as useIsMobile
 * (useState + useEffect trips react-hooks/set-state-in-effect). The server
 * cannot know the stored theme, so the active state only renders after
 * hydration — the standard next-themes mounted pattern without the mismatch.
 */
function useMounted() {
  return React.useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const activeTheme = mounted ? (theme ?? "system") : undefined;

  return (
    <div
      role="group"
      aria-label="Theme"
      data-testid="theme-toggle"
      className="glass-panel-soft inline-flex items-center gap-1 rounded-lg p-1"
    >
      {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = activeTheme === value;

        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={active}
            data-testid={`theme-toggle-${value}`}
            onClick={() => setTheme(value)}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-primary",
              active
                ? "bg-surface-strong text-foreground shadow-sm"
                : "text-muted-foreground hover:bg-surface-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
