import { z } from "zod";

export const companySettingsSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string().min(1, "Organization name is required").max(200),
  organizationNumber: z.string().regex(/^\d{6}-\d{4}$/, "Swedish org number format is XXXXXX-XXXX"),
  addressLine1: z.string().min(1).max(200),
  addressLine2: z.string().max(200).optional(),
  postalCode: z.string().regex(/^\d{3}\s?\d{2}$/, "Swedish postal code format is XXX XX"),
  city: z.string().min(1).max(100),
  contactEmail: z.string().email(),
  contactPhone: z.string().max(50).optional(),
  bankIban: z.string().max(34).optional(),
  bankBic: z.string().max(11).optional(),
});

export type CompanySettings = z.infer<typeof companySettingsSchema>;
