import type { ReactNode } from "react";

type ScreenHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  aside?: ReactNode;
  testId?: string;
};

export function ScreenHeader({ eyebrow, title, description, aside, testId }: ScreenHeaderProps) {
  return (
    <section className="glass-panel rounded-[32px] p-5 md:p-6" data-testid={testId}>
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-2xl">
          <p className="text-[0.7rem] uppercase tracking-[0.28em] text-[var(--color-text-muted)]">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-[2.8rem]">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>
        </div>
        {aside ? <div className="xl:max-w-sm xl:flex-1">{aside}</div> : null}
      </div>
    </section>
  );
}
