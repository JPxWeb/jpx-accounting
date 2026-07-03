/**
 * Brand constants for non-CSS consumers (email templates, PDF export, OG images).
 * The design system itself lives in ../styles.css — single source of truth.
 * Do not duplicate color values here; add a CSS token and read it at runtime
 * where possible.
 */
export const brand = {
  name: "JPX Accounting",
  fonts: {
    sans: `"Manrope", "Segoe UI", sans-serif`,
    mono: `"IBM Plex Mono", "SFMono-Regular", monospace`,
  },
  /** Brand teal — mirrors --teal-500 in styles.css. */
  accent: "#0f766e",
} as const;

/** @deprecated Import `brand` instead; retained for transpile compatibility. */
export const theme = {
  fonts: brand.fonts,
  colors: {
    accent: brand.accent,
    accentStrong: "#115e59",
    bg: "#e9eff2",
  },
} as const;
