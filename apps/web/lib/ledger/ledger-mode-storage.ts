export const LEDGER_MODE_STORAGE_KEY = "jpx.accounting.ledgerMode.v1";
export type LedgerMode = "inline" | "drawer";
const DEFAULT_MODE: LedgerMode = "inline";

function storage(): Storage | undefined {
  return typeof window !== "undefined" ? window.localStorage : undefined;
}

export function loadLedgerMode(): LedgerMode {
  const raw = storage()?.getItem(LEDGER_MODE_STORAGE_KEY);
  return raw === "drawer" ? "drawer" : DEFAULT_MODE;
}

export function saveLedgerMode(mode: LedgerMode): LedgerMode {
  storage()?.setItem(LEDGER_MODE_STORAGE_KEY, mode);
  return mode;
}

export function resolveLedgerMode(urlMode: LedgerMode | null): LedgerMode {
  if (urlMode === "inline" || urlMode === "drawer") return urlMode;
  return loadLedgerMode();
}
