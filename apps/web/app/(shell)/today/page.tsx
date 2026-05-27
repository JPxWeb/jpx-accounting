import { Suspense } from "react";
import { TodayScreen } from "../../../components/screens/today-screen";
import { ScreenSkeleton } from "../../../components/ui/skeleton";

export default function TodayPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <TodayScreen />
    </Suspense>
  );
}
