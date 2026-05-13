import { Suspense } from "react";

import { ReportsScreen } from "../../../components/screens/reports-screen";
import { ScreenSkeleton } from "../../../components/ui/skeleton";

export default function ReportsPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <ReportsScreen />
    </Suspense>
  );
}
