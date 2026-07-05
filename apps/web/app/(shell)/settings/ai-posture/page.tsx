import { AiPostureForm } from "../../../../components/settings/ai-posture-form";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function AiPostureSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / AI posture"
        title="AI transparency and per-surface controls."
        description="What AI runs here, the EU AI Act Article 50 transparency notice, and per-surface switches. Human approval stays mandatory for every posting regardless."
      />
      <AiPostureForm />
    </div>
  );
}
