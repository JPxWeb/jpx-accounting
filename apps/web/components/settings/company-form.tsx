"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CompanySettings,
  companySettingsSchema,
  type CountryCode,
  countryCodeSchema,
  DEFAULT_AI_POSTURE,
  DEFAULT_WORKSPACE_PROFILE,
} from "@jpx-accounting/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type Control, useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { messagesLocale } from "../../lib/message-locale";
import { Button } from "../ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ScreenSkeleton } from "../ui/skeleton";

const COUNTRY_LABELS: Record<CountryCode, string> = { SE: "Sweden" };

const COUNTRY_OPTIONS = countryCodeSchema.options.map((code) => ({ value: code, label: COUNTRY_LABELS[code] }));

const LOCALE_OPTIONS = [
  { value: "sv-SE", label: "Svenska" },
  { value: "en-GB", label: "English" },
];

const CURRENCY_OPTIONS = ["SEK", "EUR", "NOK", "DKK", "GBP", "USD"].map((code) => ({ value: code, label: code }));

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const FISCAL_YEAR_START_OPTIONS = MONTH_LABELS.map((label, index) => ({
  value: `${String(index + 1).padStart(2, "0")}-01`,
  label,
}));

// VAT reporting cadence (Task 5.10) — drives the statutory tax calendar and
// the VAT widgets. Values come from `vatPeriodSchema` in contracts.
const VAT_PERIOD_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

type ProfileSelectName =
  | "profile.country"
  | "profile.locale"
  | "profile.currency"
  | "profile.fiscalYearStart"
  | "profile.vatPeriod";

function ProfileSelectField({
  control,
  name,
  label,
  options,
  testId,
}: {
  control: Control<CompanySettings>;
  name: ProfileSelectName;
  label: string;
  options: readonly { value: string; label: string }[];
  testId: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select items={options} value={field.value} onValueChange={(value) => field.onChange(value)}>
            <FormControl>
              <SelectTrigger data-testid={testId} className="w-full">
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function CompanyFormFields({ defaultData }: { defaultData: CompanySettings }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const form = useForm<CompanySettings>({
    // @hookform/resolvers v5.2 has an overload-resolution bug on Zod v4 schemas:
    // TS picks the Zod 3 overload first and fails on a missing `_def.typeName`.
    // The runtime is correct (resolver duck-types the schema). Cast keeps the
    // call site type-safe for the form (useForm<CompanySettings>) without
    // affecting runtime behavior.
    resolver: zodResolver(companySettingsSchema as never),
    defaultValues: defaultData,
  });

  const mutation = useMutation({
    mutationFn: (input: CompanySettings) => apiClient.saveCompanySettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(["company-settings"], saved);
      // The message locale is cookie-driven (next-intl without routing);
      // refresh re-renders server components with the new catalog + html lang.
      document.cookie = `NEXT_LOCALE=${messagesLocale(saved.profile.locale)}; path=/; max-age=31536000`;
      router.refresh();
      toast.success("Company settings saved.");
    },
    onError: () => {
      toast.error("Could not save company settings.");
    },
  });

  return (
    <Form {...form}>
      <form
        data-testid="company-form"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="organizationName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="organizationNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Organization number</FormLabel>
              <FormControl>
                <Input placeholder="556677-8899" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="addressLine1"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="postalCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Postal code</FormLabel>
                <FormControl>
                  <Input placeholder="111 22" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="contactEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Contact email</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <fieldset className="space-y-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium text-foreground">Workspace profile</legend>
          <div className="grid grid-cols-2 gap-4">
            <ProfileSelectField
              control={form.control}
              name="profile.country"
              label="Country"
              options={COUNTRY_OPTIONS}
              testId="company-profile-country"
            />
            <ProfileSelectField
              control={form.control}
              name="profile.locale"
              label="Locale"
              options={LOCALE_OPTIONS}
              testId="company-profile-locale"
            />
            <ProfileSelectField
              control={form.control}
              name="profile.currency"
              label="Currency"
              options={CURRENCY_OPTIONS}
              testId="company-profile-currency"
            />
            <ProfileSelectField
              control={form.control}
              name="profile.fiscalYearStart"
              label="Fiscal year start"
              options={FISCAL_YEAR_START_OPTIONS}
              testId="company-profile-fiscal-year-start"
            />
            <ProfileSelectField
              control={form.control}
              name="profile.vatPeriod"
              label="VAT period"
              options={VAT_PERIOD_OPTIONS}
              testId="company-vat-period"
            />
          </div>
        </fieldset>
        <Button type="submit" disabled={mutation.isPending} data-testid="company-form-submit">
          {mutation.isPending ? "Saving…" : "Save company"}
        </Button>
      </form>
    </Form>
  );
}

const EMPTY_COMPANY_SETTINGS: CompanySettings = {
  organizationId: "org_default",
  organizationName: "",
  organizationNumber: "",
  addressLine1: "",
  postalCode: "",
  city: "",
  contactEmail: "",
  profile: DEFAULT_WORKSPACE_PROFILE,
  aiPosture: DEFAULT_AI_POSTURE,
};

export function CompanyForm() {
  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });

  if (settingsQuery.isLoading) return <ScreenSkeleton />;

  return <CompanyFormFields defaultData={settingsQuery.data ?? EMPTY_COMPANY_SETTINGS} />;
}
