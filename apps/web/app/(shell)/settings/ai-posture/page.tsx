import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function AiPostureSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / AI posture"
        title="AI confidence thresholds and surface controls."
        description="Auto-approval threshold (Phase 2), enabled AI surfaces, and the kill-switch. Full controls land in Phase 8."
      />
    </div>
  );
}
