import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function TeamSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Team & roles"
        title="Members, invitations, and role matrix."
        description="Owner / Bookkeeper / Read-only role assignments. Full team management lands in Phase 8."
      />
    </div>
  );
}
