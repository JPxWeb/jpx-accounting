import type { RuntimeMode, TenantScope } from "@jpx-accounting/contracts";
import type { LedgerStore } from "@jpx-accounting/domain";
import { type MemoryLedgerStore, SupabaseLedgerStore } from "@jpx-accounting/domain";
import type { SupabaseClient } from "@jpx-accounting/supabase-client";

import { LedgerStoreUnavailableError } from "./runtime";

class UnavailableLedgerStore implements LedgerStore {
  constructor(private readonly reason: string) {}

  private async fail(): Promise<never> {
    throw new LedgerStoreUnavailableError(this.reason);
  }

  async createEvidence() {
    return this.fail();
  }

  async composeEvidence() {
    return this.fail();
  }

  async getEvidenceContext() {
    return this.fail();
  }

  async findReviewByVoucher() {
    return this.fail();
  }

  async getReviewFeed() {
    return this.fail();
  }

  async getReports() {
    return this.fail();
  }

  async getBalances() {
    return this.fail();
  }

  async getVat() {
    return this.fail();
  }

  async getSnapshot() {
    return this.fail();
  }

  async getEvents() {
    return this.fail();
  }

  async suggestVoucher() {
    return this.fail();
  }

  async applyReviewDecision() {
    return this.fail();
  }

  async answerAssistantQuestion() {
    return this.fail();
  }

  async runSimulation() {
    return this.fail();
  }

  async getCloseRun() {
    return this.fail();
  }

  async getCompanySettings() {
    return this.fail();
  }

  async saveCompanySettings() {
    return this.fail();
  }
}

export type LedgerStoreScope = TenantScope & { userId: string };

export type CreateLedgerStoreDeps = {
  runtimeMode: RuntimeMode;
  supabase: SupabaseClient | null;
  demoStoreRef: { current: MemoryLedgerStore };
};

export function createLedgerStore(deps: CreateLedgerStoreDeps, scope: LedgerStoreScope): LedgerStore {
  if (deps.runtimeMode === "demo") {
    return deps.demoStoreRef.current;
  }

  if (deps.supabase) {
    return new SupabaseLedgerStore(deps.supabase, scope);
  }

  return new UnavailableLedgerStore(
    "Workspace data is unavailable in normal mode until a non-demo LedgerStore implementation is configured.",
  );
}
