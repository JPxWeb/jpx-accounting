type UnavailableStateProps = {
  title: string;
  message: string;
  testId?: string;
};

export function UnavailableState({ title, message, testId }: UnavailableStateProps) {
  return (
    <div className="page-shell">
      <section className="glass-panel rounded-3xl p-6 sm:p-7" data-testid={testId}>
        <p className="text-eyebrow">Unavailable</p>
        <h1 className="mt-3 text-2xl font-semibold text-[var(--color-text)]">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">{message}</p>
      </section>
    </div>
  );
}
