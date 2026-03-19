import { ScreenHeader } from "../ui/screen-header";

export function SettingsScreen() {
  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Control Plane"
        title="Architecture guardrails baked into the product surface."
        description="This slice makes the platform posture legible: Sweden-hosted deployment, append-only accounting events, and clear separation between advisory intelligence and mutation authority."
        testId="settings-hero"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="glass-panel rounded-[28px] p-5" data-testid="deployment-posture">
          <h2 className="text-lg font-semibold">Deployment posture</h2>
          <ul className="mt-4 space-y-3 text-sm text-[var(--color-text-muted)]">
            <li>Azure in Sweden Central, Supabase in Stockholm, immutable evidence in Blob storage.</li>
            <li>Responses API is the default inference lane; agent service is reserved for advisory orchestration.</li>
            <li>Preview-only automation remains outside the production mutation path.</li>
          </ul>
        </section>

        <section className="glass-panel rounded-[28px] p-5" data-testid="audit-spine">
          <h2 className="text-lg font-semibold">Audit spine</h2>
          <ul className="mt-4 space-y-3 text-sm text-[var(--color-text-muted)]">
            <li>Append-only events are the legal source of truth.</li>
            <li>Read models power the UI, never the other way around.</li>
            <li>Corrections are new events with actor and timestamp provenance.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
