import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildJoyrideLocale } from "../../apps/web/lib/onboarding/joyride-locale";

type OnboardingControls = Record<string, string> & {
  back: string;
  close: string;
  last: string;
  next: string;
  nextWithProgress: string;
  skip: string;
};

type OnboardingMessages = {
  onboarding: {
    controls: OnboardingControls;
  };
};

function loadMessages(locale: "en" | "sv"): OnboardingMessages {
  const raw = readFileSync(new URL(`../../apps/web/messages/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as OnboardingMessages;
}

function createStrictFakeTranslator(messages: OnboardingMessages) {
  const controls = messages.onboarding.controls;

  const resolve = (key: string): string => {
    const shortKey = key.startsWith("controls.") ? key.slice("controls.".length) : key;
    const message = controls[shortKey];
    if (message === undefined) {
      throw new Error(`MISSING_KEY: "${key}"`);
    }
    return message;
  };

  const t = ((key: string) => {
    const message = resolve(key);
    if (message.includes("{")) {
      throw new Error(`FORMATTING_ERROR: missing ICU values for "${key}"`);
    }
    return message;
  }) as Parameters<typeof buildJoyrideLocale>[0];

  t.raw = (key: "controls.nextWithProgress"): string => resolve(key);

  return t;
}

describe("onboarding-joyride-locale", () => {
  it("keeps Joyride {current}/{total} tokens in en and sv message files", () => {
    for (const locale of ["en", "sv"] as const) {
      const template = loadMessages(locale).onboarding.controls.nextWithProgress;
      assert.match(template, /\{current\}/);
      assert.match(template, /\{total\}/);
    }
  });

  it("buildJoyrideLocale uses t.raw for nextWithProgress without ICU formatting", () => {
    const en = loadMessages("en");
    const t = createStrictFakeTranslator(en);
    const locale = buildJoyrideLocale(t);

    assert.equal(locale.nextWithProgress, en.onboarding.controls.nextWithProgress);
    assert.match(locale.nextWithProgress, /\{current\}/);
    assert.match(locale.nextWithProgress, /\{total\}/);

    for (const key of ["back", "close", "last", "next", "skip"] as const) {
      assert.equal(locale[key], en.onboarding.controls[key]);
      assert.ok(locale[key].length > 0);
    }
  });

  it("would fail if nextWithProgress went through t() instead of t.raw", () => {
    const en = loadMessages("en");
    const t = createStrictFakeTranslator(en);

    assert.throws(() => t("controls.nextWithProgress" as "controls.back"), /FORMATTING_ERROR/);
  });
});
