"use client";

import { formatRuntimeModeLabel } from "../../lib/presentation";
import { webRuntimeConfig } from "../../lib/runtime-config";
import { ScreenHeader } from "../ui/screen-header";

function ComingSoon({ title, body, testId }: { title: string; body: string; testId?: string }) {
  return (
    <section className="glass-panel rounded-xl p-5" data-testid={testId}>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="mt-3 text-sm text-muted-foreground">{body}</p>
      <p className="text-eyebrow mt-4">Coming soon</p>
    </section>
  );
}

export function SettingsAboutScreen() {
  const today = new Date();

  return (
    <div className="space-y-8">
      <ScreenHeader
        eyebrow="Settings / About"
        title="About this build"
        description="This slice makes the platform posture legible: Sweden-hosted deployment, append-only accounting events, and clear separation between advisory intelligence and mutation authority."
        testId="settings-hero"
      />

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Status</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Read-only picture of how this build is running today. Mutations still flow through the inbox review path.
        </p>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="glass-panel rounded-xl p-5" data-testid="runtime-posture">
            <h3 className="text-lg font-semibold">Runtime posture</h3>
            <ul className="mt-4 list-none space-y-3 text-sm text-muted-foreground">
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
            <h3 className="text-lg font-semibold">Deployment posture</h3>
            <ul className="mt-4 list-none space-y-3 text-sm text-muted-foreground">
              <li>Azure in Sweden Central, Supabase in Stockholm, immutable evidence in Blob storage.</li>
              <li>Normal mode uses the real API path and does not substitute synthetic accounting data.</li>
              <li>Preview-only automation remains outside the production mutation path.</li>
            </ul>
          </section>

          <section data-testid="workspace-info" className="glass-panel rounded-xl p-5">
            <p className="text-eyebrow">Workspace</p>
            <h3 className="mt-2 text-lg font-semibold">Sweden Central · Stockholm</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Today is{" "}
              <time dateTime={today.toISOString().slice(0, 10)} suppressHydrationWarning>
                {new Intl.DateTimeFormat("sv-SE").format(today)}
              </time>
              .
            </p>
          </section>

          <section className="glass-panel rounded-xl p-5" data-testid="audit-spine">
            <h3 className="text-lg font-semibold">Audit spine</h3>
            <ul className="mt-4 list-none space-y-3 text-sm text-muted-foreground">
              <li>Append-only events are the legal source of truth.</li>
              <li>Read models power the UI, never the other way around.</li>
              <li>Corrections are new events with actor and timestamp provenance.</li>
            </ul>
          </section>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-foreground">Configuration</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          These areas map to what operators expect in a production workspace. Wiring arrives feature-by-feature.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          <ComingSoon
            title="Profile"
            body="Signed-in identity, personal preferences, and session visibility across devices."
          />
          <ComingSoon title="Workspace" body="Tenant name, fiscal calendar, chart defaults, and environment labels." />
          <ComingSoon
            title="Integrations"
            body="Skatteverket declarations, bank feeds, and payroll hand-offs with explicit trust tiers."
          />
          <ComingSoon
            title="Team"
            body="Invite colleagues, delegate review lanes, and separate advisory from posting roles."
          />
          <ComingSoon
            title="Billing"
            body="Subscription, usage, and invoice delivery for the JPX workspace."
            testId="billing-card"
          />
        </div>
      </div>
    </div>
  );
}
