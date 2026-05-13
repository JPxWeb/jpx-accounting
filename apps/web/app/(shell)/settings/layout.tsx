import type { ReactNode } from "react";

import { SettingsSidebar } from "../../../components/settings/settings-sidebar";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="page-shell space-y-6">
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <SettingsSidebar />
        <main>{children}</main>
      </div>
    </div>
  );
}
