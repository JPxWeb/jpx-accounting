import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function IntegrationsSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Integrations"
        title="Bank feeds, Skatteverket, and accountant access."
        description="Connection cards for external services. Full integrations land in Phase 8."
      />
    </div>
  );
}
