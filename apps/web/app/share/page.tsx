type SharePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const title = typeof params.title === "string" ? params.title : "Shared item";
  const text = typeof params.text === "string" ? params.text : "";
  const url = typeof params.url === "string" ? params.url : "";

  return (
    <main className="page-shell min-h-screen py-8 sm:py-12">
      <section
        className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1.1fr)_22rem]"
        data-testid="share-target-page"
      >
        <article className="glass-panel rounded-4xl p-6 sm:p-7">
          <p className="text-eyebrow">Share Target</p>
          <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
          <p className="mt-4 text-sm leading-6 text-[var(--color-text-muted)]">
            Shared content lands here as a focused intake surface. The main app shell stays out of the way so capture
            can finish quickly on mobile.
          </p>
          <div className="glass-panel-inset mt-6 space-y-3 rounded-2xl p-4">
            <p className="text-sm font-medium">Shared text</p>
            <p className="text-sm text-[var(--color-text-muted)]" data-testid="share-text">
              {text || "No text supplied."}
            </p>
            <p className="text-sm font-medium">Shared URL</p>
            <p className="break-all text-sm text-[var(--color-accent)]" data-testid="share-url">
              {url || "No URL supplied."}
            </p>
          </div>
        </article>

        <aside className="glass-panel-soft rounded-4xl p-5">
          <p className="text-eyebrow">Capture posture</p>
          <div className="mt-4 space-y-3 text-sm text-[var(--color-text-muted)]">
            <div className="glass-panel-inset rounded-xl px-4 py-4">
              Share-target intake is separate from the main dock and rail chrome.
            </div>
            <div className="glass-panel-inset rounded-xl px-4 py-4">
              The next wiring step is converting these fields into a draft evidence item.
            </div>
            <div className="glass-panel-inset rounded-xl px-4 py-4">
              Until upload plumbing lands, the surface stays explicit about scaffold behavior.
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
