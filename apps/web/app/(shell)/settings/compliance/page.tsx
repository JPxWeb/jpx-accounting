import { getTranslations } from "next-intl/server";

import { ComplianceIntegrityPanel } from "../../../../components/settings/compliance-integrity-panel";
import { ComplianceAlertsPanel } from "../../../../components/settings/compliance-alerts-panel";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default async function ComplianceSettingsPage() {
  const t = await getTranslations("settings.compliance");
  return (
    <div className="space-y-6">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <ComplianceIntegrityPanel />
      <ComplianceAlertsPanel />
    </div>
  );
}
