import assert from "node:assert/strict";
import test from "node:test";

import { formatMoney, formatPercent, formatShortDate } from "../../apps/web/lib/presentation";

test("formatMoney keeps two decimals and explicit SEK", () => {
  assert.equal(formatMoney(1249.8).replace(/\s/g, " "), "1 249,80 SEK");
  assert.equal(formatMoney(0), "0,00 SEK");
});

test("formatShortDate returns a short Swedish date", () => {
  assert.match(formatShortDate("2026-03-19"), /19/);
});

test("formatPercent returns Swedish percent formatting", () => {
  assert.equal(formatPercent(0.71).replace(/\s/g, " "), "71 %");
});
