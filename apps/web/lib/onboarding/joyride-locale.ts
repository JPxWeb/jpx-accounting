/**
 * Joyride locale labels from next-intl messages. `nextWithProgress` MUST bypass
 * ICU formatting: react-joyride replaces the literal {current}/{total} tokens
 * itself (replaceLocaleContent), so `t()` would report FORMATTING_ERROR for
 * missing values on every shell render. `t.raw` hands Joyride the template.
 */
export type JoyrideLocaleTranslator = {
  (key: "controls.back" | "controls.close" | "controls.last" | "controls.next" | "controls.skip"): string;
  raw: (key: "controls.nextWithProgress") => string;
};

export type JoyrideLocaleLabels = {
  back: string;
  close: string;
  last: string;
  next: string;
  nextWithProgress: string;
  skip: string;
};

export function buildJoyrideLocale(t: JoyrideLocaleTranslator): JoyrideLocaleLabels {
  return {
    back: t("controls.back"),
    close: t("controls.close"),
    last: t("controls.last"),
    next: t("controls.next"),
    nextWithProgress: t.raw("controls.nextWithProgress"),
    skip: t("controls.skip"),
  };
}
