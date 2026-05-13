import { ScreenHeader } from "../../../components/ui/screen-header";

export default function CapturePage() {
  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Capture"
        title="Add evidence, see drafts, browse the archive."
        description="The single home for everything you've captured — drafts in progress, freshly uploaded, fully archived. Full implementation lands in Phase 5."
      />
    </div>
  );
}
