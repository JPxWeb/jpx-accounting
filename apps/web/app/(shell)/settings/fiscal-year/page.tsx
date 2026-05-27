import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function FiscalYearSettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Fiscal year & VAT"
        title="Fiscal year and VAT reporting cadence."
        description="Configure fiscal year start month and VAT reporting period (monthly / quarterly / annually). Full form lands in Phase 8."
      />
    </div>
  );
}
