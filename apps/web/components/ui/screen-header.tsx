import type { ReactNode } from "react";

type ScreenHeaderProps = {
  eyebrow: string;
  title: string;
  lede?: ReactNode;
  description: string;
  aside?: ReactNode;
  testId?: string;
};

export function ScreenHeader({ eyebrow, title, lede, description, aside, testId }: ScreenHeaderProps) {
  return (
    <section className="glass-panel rounded-xl p-5 md:p-6" data-testid={testId}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-eyebrow">{eyebrow}</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight md:text-[2.8rem]">{title}</h1>
          {lede != null ? <p className="mt-3 max-w-2xl text-base font-medium text-foreground">{lede}</p> : null}
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        {aside ? <div className="w-full lg:max-w-md lg:flex-1">{aside}</div> : null}
      </div>
    </section>
  );
}
