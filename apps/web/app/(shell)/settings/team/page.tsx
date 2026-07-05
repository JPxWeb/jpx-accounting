import { getTranslations } from "next-intl/server";

import { TeamOverview } from "../../../../components/settings/team-overview";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default async function TeamSettingsPage() {
  const t = await getTranslations("settings.team");
  return (
    <div className="space-y-6">
      <ScreenHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />
      <TeamOverview />
    </div>
  );
}
