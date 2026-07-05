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
  organizationId: "org_test",
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
