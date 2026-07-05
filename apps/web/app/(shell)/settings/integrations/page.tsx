import { getTranslations } from "next-intl/server";

import { IntegrationsPosture } from "../../../../components/settings/integrations-posture";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default async function IntegrationsSettingsPage() {
  const t = await getTranslations("settings.integrations");
  return (
    <div className="space-y-6">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <IntegrationsPosture />
    </div>
  );
}
