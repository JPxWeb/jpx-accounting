type SharePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SharePage({ searchParams }: SharePageProps) {
  const params = await searchParams;
  const title = typeof params.title === "string" ? params.title : "Shared item";
  const text = typeof params.text === "string" ? params.text : "";
  const url = typeof params.url === "string" ? params.url : "";

  return (
    <div className="page-shell">
      <section className="glass-panel rounded-[28px] p-6" data-testid="share-target-page">
        <p className="text-sm uppercase tracking-[0.24em] text-[var(--color-text-muted)]">Share Target</p>
        <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
          This route is ready for mobile share-target ingestion. The next step is wiring the shared content into
          evidence creation and background upload.
        </p>
        <div className="mt-6 space-y-3 rounded-[22px] border border-[var(--color-border)] bg-white/70 p-4">
          <p className="text-sm font-medium">Shared text</p>
          <p className="text-sm text-[var(--color-text-muted)]" data-testid="share-text">
            {text || "No text supplied."}
          </p>
          <p className="text-sm font-medium">Shared URL</p>
          <p className="text-sm text-[var(--color-accent)] break-all" data-testid="share-url">
            {url || "No URL supplied."}
          </p>
        </div>
      </section>
    </div>
  );
}
