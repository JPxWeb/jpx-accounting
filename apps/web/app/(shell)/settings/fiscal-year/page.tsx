import { getTranslations } from "next-intl/server";

import { FiscalYearForm } from "../../../../components/settings/fiscal-year-form";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default async function FiscalYearSettingsPage() {
  const t = await getTranslations("settings.fiscalYear");
  return (
    <div className="space-y-6">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <FiscalYearForm />
    </div>
  );
}
