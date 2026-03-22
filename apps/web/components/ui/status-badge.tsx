type StatusBadgeProps = {
  status: string;
  variant: "accent" | "success" | "warning" | "danger" | "info";
  testId?: string;
};

const variantStyles = {
  accent: "bg-[var(--color-accent-soft)] text-[var(--color-accent)]",
  success: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
  warning: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  info: "bg-[var(--color-info-soft)] text-[var(--color-info)]",
};

export function StatusBadge({ status, variant, testId }: StatusBadgeProps) {
  return (
    <span className={`rounded-lg px-3 py-1 text-caption font-semibold ${variantStyles[variant]}`} data-testid={testId}>
      {status}
    </span>
  );
}
