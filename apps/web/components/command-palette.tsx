"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { WorkspaceSnapshot } from "@jpx-accounting/contracts";

import { apiClient } from "../lib/client";
import { useDialogFocusTrap } from "../lib/focus-trap";

type Hit = {
  id: string;
  label: string;
  description: string;
  href: string;
};

const isMacPlatform = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const shortcutHint = isMacPlatform ? "⌘K" : "Ctrl K";

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { data } = useQuery({
    queryKey: ["workspace"],
    queryFn: () => apiClient.getSnapshot(),
    enabled: open,
    staleTime: 30_000,
  });

  const hits = useMemo(() => buildHits(data, query), [data, query]);

  const handleClose = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  useDialogFocusTrap(dialogRef, open, handleClose, inputRef);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-[rgba(10,18,24,0.36)] p-4 pt-[12vh] backdrop-blur-sm"
          data-testid="command-palette-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Search workspace"
            data-testid="command-palette"
            className="glass-chrome w-full max-w-lg rounded-3xl border border-[var(--color-border)] p-4 shadow-[var(--shadow-md)]"
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search vouchers, reviews, accounts…"
              className="glass-panel-inset w-full rounded-xl px-4 py-3 text-sm outline-none"
              data-testid="command-palette-input"
            />
            <ul className="mt-3 max-h-72 overflow-y-auto" role="listbox" aria-label="Search results">
              {hits.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]">No matches</li>
              ) : (
                hits.map((hit) => (
                  <li key={hit.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      className="w-full rounded-xl px-3 py-3 text-left text-sm hover:bg-[var(--color-surface-muted)]"
                      onClick={() => {
                        router.push(hit.href);
                        handleClose();
                      }}
                    >
                      <span className="font-medium text-[var(--color-text)]">{hit.label}</span>
                      <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{hit.description}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <p className="text-eyebrow mt-3 text-center text-[var(--color-text-muted)]">
              Esc to close · {shortcutHint}
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function buildHits(data: WorkspaceSnapshot | undefined, raw: string): Hit[] {
  if (!data) {
    return [];
  }
  const q = raw.trim().toLowerCase();
  const hits: Hit[] = [];

  const reviewByVoucher = new Map<string, (typeof data.reviews)[number]>();
  for (const r of data.reviews) {
    reviewByVoucher.set(r.voucherId, r);
  }

  for (const v of data.vouchers) {
    const supplier = v.voucherFields.supplierName ?? "";
    const gross = v.voucherFields.grossAmount;
    const line = `${v.voucherNumber} ${supplier} ${gross ?? ""}`.trim();
    if (
      !q ||
      line.toLowerCase().includes(q) ||
      v.voucherNumber.toLowerCase().includes(q) ||
      supplier.toLowerCase().includes(q)
    ) {
      const review = reviewByVoucher.get(v.id);
      hits.push({
        id: `v-${v.id}`,
        label: v.voucherNumber,
        description: supplier || "Voucher",
        href: review ? `/#review-${review.id}` : "/",
      });
    }
  }

  for (const r of data.reviews) {
    const bucket = `${r.title} ${r.status}`.toLowerCase();
    if (!q || bucket.includes(q) || r.status.toLowerCase().includes(q)) {
      hits.push({
        id: `r-${r.id}`,
        label: r.title,
        description: `Review · ${r.status}`,
        href: `/#review-${r.id}`,
      });
    }
  }

  for (const b of data.reports.balances) {
    const bucket = `${b.accountNumber} ${b.accountName}`.toLowerCase();
    if (!q || bucket.includes(q)) {
      hits.push({
        id: `a-${b.accountNumber}`,
        label: `${b.accountNumber} ${b.accountName}`,
        description: "Account balance",
        href: "/reports",
      });
    }
  }

  return hits.slice(0, 40);
}
