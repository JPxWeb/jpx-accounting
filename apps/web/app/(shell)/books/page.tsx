import { Suspense } from "react";

import { BooksScreen } from "../../../components/screens/books-screen";
import { ScreenSkeleton } from "../../../components/ui/skeleton";

export default function BooksPage() {
  return (
    <Suspense fallback={<ScreenSkeleton />}>
      <BooksScreen />
    </Suspense>
  );
}
