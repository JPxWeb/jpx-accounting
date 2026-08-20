import assert from "node:assert/strict";
import test from "node:test";

import {
  aiPostureSchema,
  companySettingsSchema,
  countryValidationRegistry,
  DEFAULT_AI_POSTURE,
  DEFAULT_WORKSPACE_PROFILE,
  workspaceProfileSchema,
} from "@jpx-accounting/contracts";

const validBase = {
  organizationName: "Test AB",
  organizationNumber: "556677-8899",
  addressLine1: "Kungsgatan 1",
  postalCode: "111 22",
  city: "Stockholm",
  contactEmail: "test@example.com",
};

test("DEFAULT_WORKSPACE_PROFILE carries the Sweden defaults", () => {
  assert.deepEqual(DEFAULT_WORKSPACE_PROFILE, {
    country: "SE",
    locale: "sv-SE",
    currency: "SEK",
    fiscalYearStart: "01-01",
    vatPeriod: "quarterly",
  });
});

test("legacy company settings without a profile parse to Sweden defaults", () => {
  const parsed = companySettingsSchema.parse(validBase);
  assert.deepEqual(parsed.profile, DEFAULT_WORKSPACE_PROFILE);
});

test("companySettingsSchema strips a client-posted organizationId", () => {
  const parsed = companySettingsSchema.parse({ ...validBase, organizationId: "org_evil" });
  assert.ok(!("organizationId" in parsed));
});

test("invalid SE organization number reports at the organizationNumber path", () => {
  const result = companySettingsSchema.safeParse({ ...validBase, organizationNumber: "12345" });
  assert.equal(result.success, false);
  if (!result.success) {
    const issue = result.error.issues.find((entry) => entry.path[0] === "organizationNumber");
    assert.ok(issue, "expected an issue at path organizationNumber");
    assert.equal(issue?.message, countryValidationRegistry.SE.organizationNumber.message);
  }
});

test("invalid SE postal code reports at the postalCode path", () => {
  const result = companySettingsSchema.safeParse({ ...validBase, postalCode: "ABC" });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((entry) => entry.path[0] === "postalCode"));
  }
});

test("fiscalYearStart rejects impossible months and days", () => {
  assert.equal(workspaceProfileSchema.safeParse({ fiscalYearStart: "13-01" }).success, false);
  assert.equal(workspaceProfileSchema.safeParse({ fiscalYearStart: "01-32" }).success, false);
  assert.equal(workspaceProfileSchema.safeParse({ fiscalYearStart: "07-01" }).success, true);
});

test("firstFiscalYearStart is optional, ISO-day shaped, and absent by default", () => {
  // Absent (not `undefined`-valued) on the default profile — the key must not
  // appear at all, so `exactOptionalPropertyTypes` spreads stay clean.
  assert.equal("firstFiscalYearStart" in DEFAULT_WORKSPACE_PROFILE, false);

  const parsed = workspaceProfileSchema.parse({ firstFiscalYearStart: "2025-10-15" });
  assert.equal(parsed.firstFiscalYearStart, "2025-10-15");

  assert.equal(workspaceProfileSchema.safeParse({ firstFiscalYearStart: "2025-10" }).success, false);
  assert.equal(workspaceProfileSchema.safeParse({ firstFiscalYearStart: "10-15" }).success, false);
  assert.equal(workspaceProfileSchema.safeParse({ firstFiscalYearStart: "" }).success, false);
});

test("firstFiscalYearStart rejects calendar-impossible dates the shape regex would accept", () => {
  // The shape regex alone passes both of these; only the calendar round trip
  // catches them (Date silently rolls Feb 30 over into March).
  const impossibleMonthAndDay = workspaceProfileSchema.safeParse({ firstFiscalYearStart: "2025-13-45" });
  assert.equal(impossibleMonthAndDay.success, false);

  const rolloverDay = workspaceProfileSchema.safeParse({ firstFiscalYearStart: "2025-02-30" });
  assert.equal(rolloverDay.success, false);
  if (!rolloverDay.success) {
    assert.ok(rolloverDay.error.issues.some((entry) => entry.path[0] === "firstFiscalYearStart"));
    assert.match(rolloverDay.error.issues[0]!.message, /real calendar date/);
  }

  // Leap days are real — 2024 is a leap year, 2025 is not.
  assert.equal(workspaceProfileSchema.safeParse({ firstFiscalYearStart: "2024-02-29" }).success, true);
  assert.equal(workspaceProfileSchema.safeParse({ firstFiscalYearStart: "2025-02-29" }).success, false);

  // The real Kapitas-replacement incorporation date still parses.
  assert.equal(workspaceProfileSchema.safeParse({ firstFiscalYearStart: "2025-10-15" }).success, true);

  // And the whole settings record rejects it end-to-end (the PUT's 400 path).
  assert.equal(
    companySettingsSchema.safeParse({ ...validBase, profile: { firstFiscalYearStart: "2025-02-30" } }).success,
    false,
  );
});

test("profile round-trips custom values through the settings schema", () => {
  const parsed = companySettingsSchema.parse({
    ...validBase,
    profile: { country: "SE", locale: "en-GB", currency: "EUR", fiscalYearStart: "05-01" },
  });
  assert.equal(parsed.profile.currency, "EUR");
  assert.equal(parsed.profile.locale, "en-GB");
  assert.equal(parsed.profile.fiscalYearStart, "05-01");
});

test("legacy profile without vatPeriod parses to the quarterly default", () => {
  const parsed = companySettingsSchema.parse({
    ...validBase,
    profile: { country: "SE", locale: "sv-SE", currency: "SEK", fiscalYearStart: "01-01" },
  });
  assert.equal(parsed.profile.vatPeriod, "quarterly");
});

test("vatPeriod round-trips and rejects unknown cadences", () => {
  const parsed = companySettingsSchema.parse({
    ...validBase,
    profile: { vatPeriod: "monthly" },
  });
  assert.equal(parsed.profile.vatPeriod, "monthly");
  assert.equal(workspaceProfileSchema.safeParse({ vatPeriod: "yearly" }).success, true);
  assert.equal(workspaceProfileSchema.safeParse({ vatPeriod: "weekly" }).success, false);
});

test("DEFAULT_AI_POSTURE enables both AI surfaces", () => {
  assert.deepEqual(DEFAULT_AI_POSTURE, { advisorEnabled: true, suggestionsEnabled: true });
});

test("legacy company settings without aiPosture parse to the enabled defaults", () => {
  const parsed = companySettingsSchema.parse(validBase);
  assert.deepEqual(parsed.aiPosture, DEFAULT_AI_POSTURE);
});

test("aiPosture round-trips per-feature toggles", () => {
  const parsed = companySettingsSchema.parse({
    ...validBase,
    aiPosture: { advisorEnabled: false, suggestionsEnabled: true },
  });
  assert.equal(parsed.aiPosture.advisorEnabled, false);
  assert.equal(parsed.aiPosture.suggestionsEnabled, true);
  // Partial payloads fill the missing toggle from the schema default.
  assert.deepEqual(aiPostureSchema.parse({ suggestionsEnabled: false }), {
    advisorEnabled: true,
    suggestionsEnabled: false,
  });
});
