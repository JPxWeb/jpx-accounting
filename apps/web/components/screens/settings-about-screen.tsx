import { formatRuntimeModeLabel } from "../../lib/presentation";
import { webRuntimeConfig } from "../../lib/runtime-config";
import { ScreenHeader } from "../ui/screen-header";

export function SettingsAboutScreen() {
  return (
    <div className="page-shell space-y-6">
      <ScreenHeader
        eyebrow="Settings / About"
        title="About this build"
        description="Architecture guardrails baked into the product surface: Sweden-hosted deployment, append-only accounting events, and clear separation between advisory intelligence and mutation authority."
        testId="settings-hero"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="glass-panel rounded-xl p-5" data-testid="runtime-posture">
          <h2 className="text-lg font-semibold">Runtime posture</h2>
          <ul className="mt-4 list-none space-y-3 text-sm text-[var(--color-text-muted)]">
            <li>{formatRuntimeModeLabel(webRuntimeConfig.runtimeMode)} is active for this web shell.</li>
            <li>
              {webRuntimeConfig.runtimeMode === "demo"
                ? "Local demo store and local AI fallback are visible on purpose."
                : "Normal mode expects API-backed behavior and surfaces unavailable state when config is missing."}
            </li>
            <li>
              Service worker registration is{" "}
              {webRuntimeConfig.disableServiceWorker
                ? "disabled for this build."
                : "enabled with static-asset-only caching."}
            </li>
          </ul>
        </section>

        <section className="glass-panel rounded-xl p-5" data-testid="deployment-posture">
          <h2 className="text-lg font-semibold">Deployment posture</h2>
          <ul className="mt-4 list-none space-y-3 text-sm text-[var(--color-text-muted)]">
            <li>Azure in Sweden Central, Supabase in Stockholm, immutable evidence in Blob storage.</li>
            <li>Normal mode uses the real API path and does not substitute synthetic accounting data.</li>
            <li>Preview-only automation remains outside the production mutation path.</li>
          </ul>
        </section>

        <section className="glass-panel rounded-xl p-5" data-testid="audit-spine">
          <h2 className="text-lg font-semibold">Audit spine</h2>
          <ul className="mt-4 list-none space-y-3 text-sm text-[var(--color-text-muted)]">
            <li>Append-only events are the legal source of truth.</li>
            <li>Read models power the UI, never the other way around.</li>
            <li>Corrections are new events with actor and timestamp provenance.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
