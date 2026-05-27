import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function ComplianceSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Compliance watch"
        title="Rule sources and alert history."
        description="Subscribed rule sources (Skatteverket, BFN, BAS) and the alert detail drawer. Full compliance watch lands in Phase 8."
      />
    </div>
  );
}
