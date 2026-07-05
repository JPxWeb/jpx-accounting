"use client";

import { useTranslations } from "next-intl";
import { suggestedPromptKeys } from "@jpx-accounting/advisor";

import { useDashboardData } from "../dashboard/use-dashboard-data";

const PROMPT_KEY_PREFIX = "advisor.prompts.";

/**
 * ≤ 3 suggested questions derived from the current observations (the advisor
 * package ships i18n KEYS — `advisor.prompts.*` here owns the copy), topped up
 * from a static fallback trio. Clicking a prompt sends it as an ordinary chat
 * message.
 */
export function SuggestedPrompts({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  const t = useTranslations("advisor.prompts");
  const tRoot = useTranslations("advisor");
  const { observations } = useDashboardData();

  const keys = suggestedPromptKeys(observations);
  if (keys.length === 0) return null;

  return (
    <div>
      <p className="text-eyebrow">{tRoot("promptsLabel")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {keys.map((key) => {
          const text = t(key.startsWith(PROMPT_KEY_PREFIX) ? key.slice(PROMPT_KEY_PREFIX.length) : key);
          return (
            <button
              key={key}
              type="button"
              data-testid="advisor-suggested-prompt"
              disabled={disabled}
              onClick={() => onPick(text)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-surface-muted disabled:opacity-60"
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
