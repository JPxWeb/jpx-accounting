import {
  invoiceRegisteredPayloadSchema,
  paymentAllocatedPayloadSchema,
  type LedgerEvent,
  type OpenInvoiceListRow,
  type PaymentAllocatedPayload,
  type PaymentHistoryListRow,
} from "@jpx-accounting/contracts";

import { round2 } from "../store-shared";

export type { OpenInvoiceListRow, PaymentHistoryListRow } from "@jpx-accounting/contracts";

type InvoiceReplayState = {
  id: string;
  direction: OpenInvoiceListRow["direction"];
  counterparty: string;
  dueDate: string;
  currency: string;
  originalAmount: number;
  allocations: PaymentAllocatedPayload[];
};

export function deriveOpenInvoiceAmount(
  lines: readonly { invoiceId: string; signedAmount: number }[],
  allocations: readonly { invoiceId: string; amount: number }[],
  invoiceId: string,
): number {
  const gross = lines.filter((line) => line.invoiceId === invoiceId).reduce((sum, line) => sum + line.signedAmount, 0);
  const paid = allocations
    .filter((allocation) => allocation.invoiceId === invoiceId)
    .reduce((sum, allocation) => sum + allocation.amount, 0);
  return round2(gross - paid);
}

function replayInvoices(events: readonly LedgerEvent[]): InvoiceReplayState[] {
  const invoices = new Map<string, InvoiceReplayState>();
  const seenPaymentIds = new Set<string>();

  for (const event of events) {
    if (event.eventType === "InvoiceRegistered") {
      const invoice = invoiceRegisteredPayloadSchema.parse(event.payload);
      if (invoices.has(invoice.invoiceId)) continue;
      invoices.set(invoice.invoiceId, {
        id: invoice.invoiceId,
        direction: invoice.direction,
        counterparty: invoice.counterparty,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        originalAmount: invoice.originalAmount,
        allocations: [],
      });
      continue;
    }

    if (event.eventType === "PaymentAllocated") {
      const allocation = paymentAllocatedPayloadSchema.parse(event.payload);
      if (seenPaymentIds.has(allocation.paymentId)) continue;
      seenPaymentIds.add(allocation.paymentId);
      const invoice = invoices.get(allocation.invoiceId);
      if (invoice) invoice.allocations.push(allocation);
    }
  }

  return [...invoices.values()];
}

export function buildOpenInvoicesList(events: LedgerEvent[]): OpenInvoiceListRow[] {
  return replayInvoices(events).flatMap((invoice) => {
    const openAmount = deriveOpenInvoiceAmount(
      [{ invoiceId: invoice.id, signedAmount: invoice.originalAmount }],
      invoice.allocations,
      invoice.id,
    );
    if (openAmount === 0) return [];

    return [
      {
        id: invoice.id,
        kind: "open_invoice" as const,
        direction: invoice.direction,
        counterparty: invoice.counterparty,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        originalAmount: invoice.originalAmount,
        openAmount,
      },
    ];
  });
}

export function buildPaymentHistoryList(events: LedgerEvent[]): PaymentHistoryListRow[] {
  const seenPaymentIds = new Set<string>();
  return events.flatMap((event) => {
    if (event.eventType !== "PaymentAllocated") return [];
    const payment = paymentAllocatedPayloadSchema.parse(event.payload);
    if (seenPaymentIds.has(payment.paymentId)) return [];
    seenPaymentIds.add(payment.paymentId);
    return [{ id: payment.paymentId, kind: "payment" as const, ...payment }];
  });
}
