type StatusBadgeProps = {
  status: string;
  variant: "accent" | "success" | "warning" | "danger" | "info";
  testId?: string;
};

const variantStyles = {
  accent: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

export function StatusBadge({ status, variant, testId }: StatusBadgeProps) {
  return (
    <span className={`rounded-lg px-3 py-1 text-caption font-semibold ${variantStyles[variant]}`} data-testid={testId}>
      {status}
    </span>
  );
}
