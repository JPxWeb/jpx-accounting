"use client";

import { type CompanySettings, DEFAULT_WORKSPACE_PROFILE } from "@jpx-accounting/contracts";
import { buildTaxTimeline, localTodayIso, resolvePeriodToken, TAX_DEADLINE_SOURCES } from "@jpx-accounting/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { apiClient } from "../../lib/client";
import { invalidateLedgerDerived } from "../../lib/query-invalidation";
import { Button } from "../ui/button";
import { SectionLabel } from "../ui/section-label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { ScreenSkeleton } from "../ui/skeleton";

/**
 * How far ahead to look for the next årsredovisning: a fiscal year that just
 * started ends in ~12 months and its annual report is due 7 months after that
 * (ÅRL 8 kap. 3 §), so ~19 months is the worst case. The limit only needs to
 * exceed the count of monthly deadlines inside the horizon.
 */
const ANNUAL_REPORT_HORIZON_DAYS = 700;
const ANNUAL_REPORT_SCAN_LIMIT = 400;

/**
 * Real fiscal-year settings (Phase 6 Task 6.2): the `profile.fiscalYearStart`
 * month select persisted through the ordinary company-settings save path,
 * plus what the choice actually drives — the current fiscal-year window
 * (unified period model) and the next statutory årsredovisning deadline from
 * the domain tax calendar. The VAT cadence is displayed read-only here; it is
 * edited together with the company profile.
 */
export function FiscalYearForm() {
  const settingsQuery = useQuery({
    queryKey: ["company-settings"],
    queryFn: () => apiClient.getCompanySettings(),
  });

  if (settingsQuery.isLoading) return <ScreenSkeleton />;

  const settings = settingsQuery.data ?? null;
  // Remount on external saves (e.g. the company form) so the local select
  // state re-initializes from the persisted profile.
  return <FiscalYearFields key={settings?.profile.fiscalYearStart ?? "unsaved"} settings={settings} />;
}

function FiscalYearFields({ settings }: { settings: CompanySettings | null }) {
  const t = useTranslations("settings.fiscalYear");
  // Month names + preview dates follow the message-catalog locale so the page
  // reads in ONE language (the workspace profile locale only drives amounts
  // and report formatting elsewhere).
  const locale = useLocale();
  const queryClient = useQueryClient();

  const profile = settings?.profile ?? DEFAULT_WORKSPACE_PROFILE;
  const [fiscalYearStart, setFiscalYearStart] = useState(profile.fiscalYearStart);
  // Phase D Task 6: optional floor for an irregular FIRST fiscal year. "" is
  // the empty-input sentinel — the contract field is absent, never "".
  const [firstFiscalYearStart, setFirstFiscalYearStart] = useState(profile.firstFiscalYearStart ?? "");

  const monthFormatter = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
  const monthOptions = Array.from({ length: 12 }, (_, index) => {
    const label = monthFormatter.format(new Date(Date.UTC(2026, index, 1)));
    return {
      value: `${String(index + 1).padStart(2, "0")}-01`,
      label: label.charAt(0).toLocaleUpperCase(locale) + label.slice(1),
    };
  });
  // A persisted mid-month start (schema allows any MM-DD) must stay selectable
  // — surface it verbatim instead of silently snapping to the 1st.
  const options = monthOptions.some((option) => option.value === fiscalYearStart)
    ? monthOptions
    : [{ value: fiscalYearStart, label: fiscalYearStart }, ...monthOptions];

  // Live preview from the SELECTED value (not the saved one): the whole point
  // of the page is showing what the start month drives before committing.
  const today = localTodayIso();
  const periodOpts = {
    fiscalYearStart,
    today,
    ...(firstFiscalYearStart !== "" ? { firstFiscalYearStart } : {}),
  };
  // Which fiscal year we are IN is a pure anchor question — derive it from the
  // UNFLOORED ytd window. (A floor may sit in the next calendar year, e.g. a
  // 09-01 anchor with an FY1 starting 2026-01-15; slicing the floored `from`
  // would then name the wrong fiscal year.) The floor is applied to the window
  // we render, below.
  const currentFyYear = Number(resolvePeriodToken("ytd", { fiscalYearStart, today }).from.slice(0, 4));
  const fyWindow = resolvePeriodToken(`fy-${currentFyYear}`, periodOpts);
  const nextAnnualReport = buildTaxTimeline({
    profile: { vatPeriod: profile.vatPeriod, fiscalYearStart, euTrade: profile.euTrade },
    today,
    horizonDays: ANNUAL_REPORT_HORIZON_DAYS,
    limit: ANNUAL_REPORT_SCAN_LIMIT,
  }).find((deadline) => deadline.kind === "annual-report");

  // Day strings parse as UTC midnight — format in UTC so the day never shifts.
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const formatDay = (day: string) => dateFormatter.format(new Date(day));

  const mutation = useMutation({
    mutationFn: (input: CompanySettings) => apiClient.saveCompanySettings(input),
    onSuccess: (saved) => {
      // Shared query key: the workspace profile provider (and with it every
      // fiscal-quarter report window and tax-timeline widget) updates live.
      queryClient.setQueryData(["company-settings"], saved);
      // Fiscal-window changes reshape report packs and audit-visible state (R18).
      invalidateLedgerDerived(queryClient);
      toast.success(t("saved"));
    },
    onError: () => {
      // Covers the contract's rejections too, not just transport failures: a
      // calendar-impossible `firstFiscalYearStart` fails `companySettingsSchema`
      // on BOTH save paths — the API's `jsonValidated` 400 (api-client throws
      // AccountingApiError) and the demo fallback's `putCompanySettings` parse.
      // The native `type="date"` input makes this practically unreachable; this
      // is the honest floor under it, and matches the company form's surface.
      toast.error(t("saveError"));
    },
  });

  return (
    <form
      data-testid="company-fiscal-year-form"
      className="glass-panel space-y-6 rounded-xl p-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!settings) return;
        // Clearing the floor must OMIT the key, not send `undefined`
        // (`exactOptionalPropertyTypes`) — an empty date input deletes it.
        const nextProfile: CompanySettings["profile"] = { ...settings.profile, fiscalYearStart };
        if (firstFiscalYearStart === "") delete nextProfile.firstFiscalYearStart;
        else nextProfile.firstFiscalYearStart = firstFiscalYearStart;
        mutation.mutate({ ...settings, profile: nextProfile });
      }}
    >
      {!settings ? (
        <p
          className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning"
          data-testid="fiscal-year-needs-company"
        >
          {t("needsCompany")}{" "}
          <Link href="/settings/company" className="font-semibold underline">
            {t("needsCompanyCta")}
          </Link>
        </p>
      ) : null}

      <div className="space-y-2">
        <SectionLabel as="label" htmlFor="fiscal-year-start">
          {t("startLabel")}
        </SectionLabel>
        <Select
          items={options}
          value={fiscalYearStart}
          onValueChange={(value) => {
            if (value !== null) setFiscalYearStart(value);
          }}
        >
          <SelectTrigger id="fiscal-year-start" data-testid="fiscal-year-start-select" className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-sm leading-6 text-muted-foreground">{t("previewNote")}</p>
      </div>

      <div className="space-y-2">
        <SectionLabel as="label" htmlFor="first-fiscal-year-start">
          {t("firstFiscalYearStartLabel")}
        </SectionLabel>
        <input
          id="first-fiscal-year-start"
          data-testid="first-fiscal-year-start-input"
          type="date"
          value={firstFiscalYearStart}
          onChange={(event) => setFirstFiscalYearStart(event.target.value)}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm sm:w-64"
        />
        <p className="text-sm leading-6 text-muted-foreground">{t("firstFiscalYearStartHint")}</p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="glass-panel-inset rounded-lg px-3 py-3">
          <dt className="text-eyebrow">{t("currentWindow")}</dt>
          {/* Clock-derived — masked so visual baselines stay date-stable. */}
          <dd
            className="mt-2 text-sm font-semibold tabular-nums text-foreground"
            data-testid="fiscal-year-window"
            data-visual-mask
          >
            {formatDay(fyWindow.from)} – {formatDay(fyWindow.to)}
          </dd>
        </div>
        <div className="glass-panel-inset rounded-lg px-3 py-3">
          <dt className="text-eyebrow">{t("arsredovisning")}</dt>
          <dd className="mt-2">
            <p
              className="text-sm font-semibold tabular-nums text-foreground"
              data-testid="fiscal-year-arsredovisning"
              data-visual-mask
            >
              {nextAnnualReport ? formatDay(nextAnnualReport.dueDate) : "—"}
            </p>
            {nextAnnualReport ? (
              <p className="mt-1 text-caption text-muted-foreground" data-visual-mask>
                {t("arsredovisningBody", { fyEnd: formatDay(fyWindow.to) })}
              </p>
            ) : null}
          </dd>
        </div>
        <div className="glass-panel-inset rounded-lg px-3 py-3 sm:col-span-2">
          <dt className="text-eyebrow">{t("vatPeriodLabel")}</dt>
          <dd className="mt-2">
            <p className="text-sm font-semibold text-foreground" data-testid="fiscal-year-vat-period">
              {t(`vatPeriods.${profile.vatPeriod}`)}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              {t("vatEditHint")}{" "}
              <Link href="/settings/company" className="font-semibold text-foreground underline">
                {t("vatEditLink")}
              </Link>
            </p>
          </dd>
        </div>
      </dl>

      <div className="border-t border-border pt-3">
        <p className="text-eyebrow">{t("sourceLabel")}</p>
        <p className="mt-2 text-caption leading-5 text-muted-foreground">
          {TAX_DEADLINE_SOURCES["sv-arsredovisning-7m"]}
        </p>
      </div>

      <Button type="submit" disabled={!settings || mutation.isPending} data-testid="fiscal-year-save">
        {mutation.isPending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
