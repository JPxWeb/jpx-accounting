import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="skeleton" className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}

function ScreenSkeleton() {
  return (
    <div className="page-shell space-y-6">
      <div className="glass-panel rounded-3xl p-5 md:p-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-4 h-10 w-3/4" />
        <Skeleton className="mt-3 h-5 w-2/3" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass-panel rounded-3xl p-5">
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 grid grid-cols-3 gap-3">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        </div>
        <div className="glass-panel rounded-3xl p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-4 h-24 rounded-2xl" />
          <Skeleton className="mt-3 h-24 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}

export { ScreenSkeleton, Skeleton };
