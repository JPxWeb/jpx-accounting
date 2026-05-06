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
  ...tseslint.config({
    files: ["services/**/*.ts", "packages/**/*.ts", "tests/**/*.ts"],
    extends: [tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  }),
  eslintConfigPrettier,
]);
