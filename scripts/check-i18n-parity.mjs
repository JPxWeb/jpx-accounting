#!/usr/bin/env node
// Enforces AGENTS.md invariant: every key in apps/web/messages/en.json must have
// a twin in sv.json and vice versa. next-intl fails at runtime on a missing key,
// so this turns a lint-staged blind spot into a deterministic CI gate. Pure Node
// (fs only) — runs without pnpm/eslint, safe on the off-PATH pnpm dev box.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "messages");

/** Flatten a nested message object into dotted leaf-key paths (arrays are leaves). */
function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

function load(locale) {
  return new Set(flatten(JSON.parse(readFileSync(join(messagesDir, `${locale}.json`), "utf8"))));
}

const en = load("en");
const sv = load("sv");
const missingInSv = [...en].filter((k) => !sv.has(k)).sort();
const missingInEn = [...sv].filter((k) => !en.has(k)).sort();

if (missingInSv.length || missingInEn.length) {
  if (missingInSv.length) {
    console.error(`❌ ${missingInSv.length} key(s) in en.json missing from sv.json:`);
    for (const k of missingInSv) console.error(`   - ${k}`);
  }
  if (missingInEn.length) {
    console.error(`❌ ${missingInEn.length} key(s) in sv.json missing from en.json:`);
    for (const k of missingInEn) console.error(`   - ${k}`);
  }
  process.exit(1);
}

console.log(`✓ i18n parity: en.json and sv.json both define ${en.size} keys.`);
