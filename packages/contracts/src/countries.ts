import { z } from "zod";

/**
 * Per-country validation registry — Sweden is an ENTRY here, not a schema
 * hardcode. Widen `countryCodeSchema` and add a registry entry when a new
 * market is populated (advisory-pivot decision: abstractions now, Sweden-only
 * data).
 */
export const countryCodeSchema = z.enum(["SE"]);
export type CountryCode = z.infer<typeof countryCodeSchema>;

export type CountryValidationRule = {
  organizationNumber: { pattern: RegExp; message: string; example: string };
  postalCode: { pattern: RegExp; message: string; example: string };
};

export const countryValidationRegistry: Record<CountryCode, CountryValidationRule> = {
  SE: {
    organizationNumber: {
      pattern: /^\d{6}-\d{4}$/,
      message: "Swedish org number format is XXXXXX-XXXX",
      example: "556677-8899",
    },
    postalCode: {
      pattern: /^\d{3}\s?\d{2}$/,
      message: "Swedish postal code format is XXX XX",
      example: "111 22",
    },
  },
};
