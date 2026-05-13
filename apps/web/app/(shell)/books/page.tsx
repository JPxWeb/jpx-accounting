import { ScreenHeader } from "../../../components/ui/screen-header";

export default function BooksPage() {
  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Books"
        title="Explore the ledger — accounts, suppliers, journal, close."
        description="Drill-through navigation across journal, general ledger, trial balance, and suppliers. Full implementation lands in Phase 3."
      />
    </div>
  );
}
