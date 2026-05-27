import { CompanyForm } from "../../../../components/settings/company-form";
import { ScreenHeader } from "../../../../components/ui/screen-header";

export default function CompanySettingsPage() {
  return (
    <div className="space-y-6">
      <ScreenHeader
        eyebrow="Settings / Company"
        title="Your organization details."
        description="Used on invoices, exports, and Skatteverket filings. Changes are versioned in the audit spine."
      />
      <div className="glass-panel rounded-xl p-5">
        <CompanyForm />
      </div>
    </div>
  );
}
