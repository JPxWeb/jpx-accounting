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
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { type Control, useForm } from "react-hook-form";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { messagesLocale } from "../../lib/message-locale";
import { invalidateLedgerDerived } from "../../lib/query-invalidation";
import { Button } from "../ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../ui/form";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ScreenSkeleton } from "../ui/skeleton";

const CURRENCY_CODES = ["SEK", "EUR", "NOK", "DKK", "GBP", "USD"] as const;
const LOCALE_CODES = ["sv-SE", "en-GB"] as const;
const VAT_PERIOD_CODES = ["monthly", "quarterly", "yearly"] as const;

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

function useCompanyFormOptions() {
  const t = useTranslations("settings.company");
  const tVat = useTranslations("settings.fiscalYear");

  return useMemo(() => {
    const countryOptions = countryCodeSchema.options.map((code) => ({
      value: code,
      label: t(`countries.${code as CountryCode}`),
    }));

    const localeOptions = LOCALE_CODES.map((code) => ({
      value: code,
      label: t(`locales.${code}`),
    }));

    const currencyOptions = CURRENCY_CODES.map((code) => ({
      value: code,
      label: t(`currencies.${code}`),
    }));

    const fiscalYearStartOptions = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      return {
        value: `${month}-01`,
        label: t(`months.${month}`),
      };
    });

    const vatPeriodOptions = VAT_PERIOD_CODES.map((code) => ({
      value: code,
      label: tVat(`vatPeriods.${code}`),
    }));

    return { countryOptions, localeOptions, currencyOptions, fiscalYearStartOptions, vatPeriodOptions };
  }, [t, tVat]);
}

function CompanyFormFields({ defaultData }: { defaultData: CompanySettings }) {
  const t = useTranslations("settings.company");
  const queryClient = useQueryClient();
  const router = useRouter();
  const { countryOptions, localeOptions, currencyOptions, fiscalYearStartOptions, vatPeriodOptions } =
    useCompanyFormOptions();

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
      // Profile changes (fiscal year, VAT cadence) cascade into report windows
      // and audit-visible ledger state — run the shared R18 sweep.
      invalidateLedgerDerived(queryClient);
      // The message locale is cookie-driven (next-intl without routing);
      // refresh re-renders server components with the new catalog + html lang.
      document.cookie = `NEXT_LOCALE=${messagesLocale(saved.profile.locale)}; path=/; max-age=31536000`;
      router.refresh();
      toast.success(t("saved"));
    },
    onError: () => {
      toast.error(t("saveError"));
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
              <FormLabel>{t("organizationName")}</FormLabel>
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
              <FormLabel>{t("organizationNumber")}</FormLabel>
              <FormControl>
                <Input placeholder={t("organizationNumberPlaceholder")} {...field} />
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
              <FormLabel>{t("address")}</FormLabel>
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
                <FormLabel>{t("postalCode")}</FormLabel>
                <FormControl>
                  <Input placeholder={t("postalCodePlaceholder")} {...field} />
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
                <FormLabel>{t("city")}</FormLabel>
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
              <FormLabel>{t("contactEmail")}</FormLabel>
              <FormControl>
                <Input type="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <fieldset className="space-y-4 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium text-foreground">{t("workspaceProfile")}</legend>
          <div className="grid grid-cols-2 gap-4">
            <ProfileSelectField
              control={form.control}
              name="profile.country"
              label={t("country")}
              options={countryOptions}
              testId="company-profile-country"
            />
            <ProfileSelectField
              control={form.control}
              name="profile.locale"
              label={t("locale")}
              options={localeOptions}
              testId="company-profile-locale"
            />
            <ProfileSelectField
              control={form.control}
              name="profile.currency"
              label={t("currency")}
              options={currencyOptions}
              testId="company-profile-currency"
            />
            <ProfileSelectField
              control={form.control}
              name="profile.fiscalYearStart"
              label={t("fiscalYearStart")}
              options={fiscalYearStartOptions}
              testId="company-profile-fiscal-year-start"
            />
            <ProfileSelectField
              control={form.control}
              name="profile.vatPeriod"
              label={t("vatPeriod")}
              options={vatPeriodOptions}
              testId="company-vat-period"
            />
          </div>
        </fieldset>
        <Button type="submit" disabled={mutation.isPending} data-testid="company-form-submit">
          {mutation.isPending ? t("saving") : t("save")}
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
