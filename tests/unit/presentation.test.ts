import assert from "node:assert/strict";
import test from "node:test";

import { formatMoney, formatPercent, formatShortDate } from "../../apps/web/lib/presentation";

// Intl emits NBSP / narrow NBSP group and literal separators; normalize to
// plain spaces so assertions stay readable (same approach as before the
// locale parameterization).
function normalize(value: string) {
  return value.replace(/\s/g, " ");
}

test("formatMoney renders per workspace profile locale + currency", () => {
  assert.equal(normalize(formatMoney(1249.8, { locale: "sv-SE", currency: "SEK" })), "1 249,80 SEK");
  assert.equal(normalize(formatMoney(0, { locale: "sv-SE", currency: "SEK" })), "0,00 SEK");
  assert.equal(normalize(formatMoney(undefined, { locale: "sv-SE", currency: "SEK" })), "0,00 SEK");
  assert.equal(normalize(formatMoney(1249.8, { locale: "en-GB", currency: "EUR" })), "EUR 1,249.80");
});

test("formatShortDate renders a short date per locale", () => {
  assert.equal(normalize(formatShortDate("2026-03-19", "sv-SE")), "19 mars");
  assert.equal(normalize(formatShortDate("2026-03-19", "en-GB")), "19 Mar");
});

test("formatShortDate falls back for missing or invalid values", () => {
  assert.equal(formatShortDate(undefined, "sv-SE"), "Today");
  assert.equal(formatShortDate("not-a-date", "en-GB"), "Today");
  assert.equal(formatShortDate(undefined, "sv-SE", "—"), "—");
});

test("formatPercent renders per locale", () => {
  assert.equal(normalize(formatPercent(0.71, "sv-SE")), "71 %");
  assert.equal(normalize(formatPercent(0.71, "en-GB")), "71%");
  assert.equal(normalize(formatPercent(0.715, "en-GB", 1)), "71.5%");
});
