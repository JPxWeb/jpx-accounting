// Root flat ESLint for the pnpm workspace (Next.js 16 native flat presets; avoids FlatCompat + eslint-config-next quirks).
import path from "node:path";
import { defineConfig, globalIgnores } from "eslint/config";
import nextTs from "eslint-config-next/typescript";
import nextVitals from "eslint-config-next/core-web-vitals";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

const WEB_FILES = ["apps/web/**/*.{js,jsx,mjs,ts,tsx}"];
const webPagesRoot = path.join(import.meta.dirname, "apps/web");

function scopeToWeb(blocks) {
  const list = Array.isArray(blocks) ? blocks : [blocks];
  return list.map((block) => {
    if (!block || typeof block !== "object") return block;
    const isGlobalIgnoreOnly =
      "ignores" in block &&
      !("files" in block) &&
      !("languageOptions" in block) &&
      !("rules" in block) &&
      !("plugins" in block);
    if (isGlobalIgnoreOnly) return block;
    const { files: _, ...rest } = block;
    return { ...rest, files: WEB_FILES };
  });
}

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/api-deploy/**",
    "**/playwright-report/**",
    "**/dist/**",
    "pnpm-lock.yaml",
  ]),
  ...scopeToWeb(nextVitals),
  ...scopeToWeb(nextTs),
  {
    files: WEB_FILES,
    rules: {
      "@next/next/no-html-link-for-pages": ["error", webPagesRoot],
    },
  },
  {
    // Design-system guardrails (advisory pivot, Phase 1): the canonical tokens
    // live in packages/ui-tokens/styles.css and are bridged to utilities in
    // apps/web/app/globals.css. App code must not bypass them.
    files: WEB_FILES,
    ignores: ["apps/web/app/globals.css"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/rounded-(3xl|4xl)/]",
          message: "rounded-3xl/4xl are retired — panels use rounded-xl, overlays rounded-2xl (unified radius scale).",
        },
        {
          selector: "TemplateElement[value.raw=/rounded-(3xl|4xl)/]",
          message: "rounded-3xl/4xl are retired — panels use rounded-xl, overlays rounded-2xl (unified radius scale).",
        },
        {
          selector: "Literal[value=/-\\[#/]",
          message: "No hex color literals in classes — add a token to ui-tokens and bridge it in globals.css.",
        },
        {
          selector: "TemplateElement[value.raw=/-\\[#/]",
          message: "No hex color literals in classes — add a token to ui-tokens and bridge it in globals.css.",
        },
        {
          selector: "Literal[value=/-\\[(var\\(--color-|rgba\\(|color-mix)/]",
          message:
            "No arbitrary-value color classes — use the bridged semantic utilities (text-foreground, bg-primary-soft, bg-surface-muted, …).",
        },
        {
          selector: "TemplateElement[value.raw=/-\\[(var\\(--color-|rgba\\(|color-mix)/]",
          message:
            "No arbitrary-value color classes — use the bridged semantic utilities (text-foreground, bg-primary-soft, bg-surface-muted, …).",
        },
      ],
    },
  },
  ...tseslint.config({
    files: ["services/**/*.ts", "packages/**/*.ts", "tests/**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  }),
  // ── Architectural seam gates ───────────────────────────────────────────────
  // The manual grep gates documented in AGENTS.md ("@dnd-kit only in
  // sortable-grid.tsx", "ai/@ai-sdk only in advisor dirs", "recharts never in
  // the dashboard") are now enforced by `pnpm lint` / CI. ESLint applies only
  // the LAST matching `no-restricted-imports` per file, so exemptions are
  // expressed as ordered override blocks — each listing the FULL restriction set
  // for the files it targets — never as block-level `ignores` (which would
  // silently clobber one another on the same rule key). Adopted from the
  // agent-harness `no-restricted-imports` pattern; adapted to jpx's seams.
  {
    // Web baseline: the dnd kit and the AI SDK stay out of general web code.
    files: WEB_FILES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@dnd-kit", "@dnd-kit/*"],
              message: "@dnd-kit belongs only in components/dashboard/sortable-grid.tsx (the one dnd abstraction).",
            },
            {
              group: ["ai", "ai/*", "@ai-sdk/*"],
              message:
                "ai / @ai-sdk (web) belong only in components/advisor/** — keeps the AI SDK out of the general web bundle.",
            },
          ],
        },
      ],
    },
  },
  {
    // Dashboard additionally bars recharts (it uses dependency-free inline SVG minis).
    files: ["apps/web/components/dashboard/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@dnd-kit", "@dnd-kit/*"],
              message: "@dnd-kit belongs only in components/dashboard/sortable-grid.tsx (the one dnd abstraction).",
            },
            { group: ["ai", "ai/*", "@ai-sdk/*"], message: "ai / @ai-sdk (web) belong only in components/advisor/**." },
            {
              group: ["recharts", "recharts/*"],
              message: "The dashboard uses inline SVG minis — recharts stays in components/reports/charts.",
            },
          ],
        },
      ],
    },
  },
  {
    // The ONE dnd abstraction: @dnd-kit allowed here; AI SDK + recharts still barred.
    files: ["apps/web/components/dashboard/sortable-grid.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["ai", "ai/*", "@ai-sdk/*"], message: "ai / @ai-sdk (web) belong only in components/advisor/**." },
            {
              group: ["recharts", "recharts/*"],
              message: "The dashboard uses inline SVG minis — recharts stays in components/reports/charts.",
            },
          ],
        },
      ],
    },
  },
  {
    // Advisor (web half): the AI SDK is allowed here; @dnd-kit still barred.
    files: ["apps/web/components/advisor/**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@dnd-kit", "@dnd-kit/*"],
              message: "@dnd-kit belongs only in components/dashboard/sortable-grid.tsx.",
            },
          ],
        },
      ],
    },
  },
  {
    // API baseline: the AI SDK is confined to services/api/src/advisor.
    files: ["services/api/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["ai", "ai/*", "@ai-sdk/*"],
              message: "ai / @ai-sdk (API) belong only in services/api/src/advisor/**.",
            },
          ],
        },
      ],
    },
  },
  {
    // Advisor (API half): the AI SDK is allowed here.
    files: ["services/api/src/advisor/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  eslintConfigPrettier,
]);
