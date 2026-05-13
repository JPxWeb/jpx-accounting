import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function RetentionSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Retention"
        title="7-year retention and legal hold."
        description="Bokföringslagen baseline plus per-class legal hold toggles. Full retention controls land in Phase 8."
      />
    </div>
  );
}
