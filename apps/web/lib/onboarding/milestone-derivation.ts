import type { CompanySettings, WorkspaceSnapshot } from "@jpx-accounting/contracts";

export type MilestoneId = "capture" | "approve" | "import" | "advisor" | "profile";

export const SEEDED_EVIDENCE_COUNT = { demo: 1, normal: 0 } as const;

export function deriveMilestones(input: {
  snapshot: WorkspaceSnapshot;
  settings: CompanySettings | null | undefined;
  advisorThreadCount: number;
  runtimeMode: "demo" | "normal";
}): Record<MilestoneId, boolean> {
  const seeded = SEEDED_EVIDENCE_COUNT[input.runtimeMode];
  return {
    capture: input.snapshot.evidence.length > seeded,
    approve: input.snapshot.reviews.some(
      (review) => review.status === "approved" || review.status === "booked-without-vat",
    ),
    import: input.snapshot.reports.journal.some((entry) => entry.voucherId.startsWith("sie_")),
    advisor: input.advisorThreadCount > 0,
    profile: Boolean(input.settings),
  };
}

export function countCompletedMilestones(milestones: Record<MilestoneId, boolean>): number {
  return (Object.keys(milestones) as MilestoneId[]).filter((key) => milestones[key]).length;
}
