# JPx Advisory AB — FY1 migration runbook (Kapitas → this product)

> Operational companion to [`2026-08-20-kfr-d-sie-migration.md`](2026-08-20-kfr-d-sie-migration.md). Run this AFTER Phase D has landed (materialized import vouchers, `targetVoucherId` attach, parse warnings, `firstFiscalYearStart`, period-scoped export, capture concurrency + 429 retry — tasks D1–D8).

**Scope:** FY1 = `2025-10-15` → `2026-08-31` — the company's real incorporation date through the first `08-31` fiscal year end.

**What this runbook is for:** getting FY1's ledger, its receipts, and their linkage into this product so FY2 runs here from day 1. It is **not** the FY1 close. Per [`2026-08-20-kapitas-replacement-readiness.md`](../specs/2026-08-20-kapitas-replacement-readiness.md), FY1's årsredovisning/INK2 is produced by an external tool from the Kapitas SIE4 file, and FY1's helårsmoms is filed from Kapitas's own momsrapport. See §10.

**Who can run it:** anyone with the local normal-mode instance up and a signed-in browser session. Steps marked **API** need a bearer token (§0.3) because two Phase-D capabilities have no UI yet.

---

## 0. Before you start

### 0.1 A durable instance

The migration must land in **normal mode** — demo mode is an in-memory store that a restart wipes. Stand it up first per [`docs/SELF_HOST.md`](../../SELF_HOST.md) (Phase A / D1), then confirm:

```bash
curl http://localhost:3001/ready
# {"ready":true,"runtimeMode":"normal","checks":{"ledger":true,"ai":true,"blob":true,"docintel":true}}
```

The API's boot line must say `"ledgerStore":"postgres"` and `"authEnabled":true`.

### 0.2 A restore point

```bash
corepack pnpm db:backup
```

Import is append-only and idempotent, so this is belt-and-braces — but the receipt bulk-capture step writes ~70 evidence rows and there is no delete route by design. A cheap snapshot beats a hand-unpick. (`pnpm db:backup` also mirrors `ACCOUNTING_BLOB_DIR`; see SELF_HOST "Backup / restore".)

### 0.3 A bearer token for the API steps

Normal mode gates **every** `/api/*` route behind `SUPABASE_JWKS_URL` — the only exemptions are `GET /api/runtime-info` (the public AI-transparency panel) and the local-disk blob byte-transfer routes, which carry their own signed-token credential. Set two shell variables:

```bash
export API_BASE=http://localhost:3001
export TOKEN='<paste>'
```

Getting `TOKEN`, version-proof: sign in at `/login`, open DevTools → **Network**, click any `/api-proxy/...` request, and copy the value after `Bearer ` in its `authorization` request header. (The session also lives in `localStorage` under `sb-<project-ref>-auth-token`, but supabase-js ≥ 2.100 may base64-wrap that value, so copying the live header is the reliable route.) Access tokens are short-lived — when a call returns 401, copy a fresh one.

On Windows, run the `curl`/`jq` snippets from Git Bash; PowerShell quoting will fight the JSON bodies.

---

## 1. Get everything out of Kapitas — first, and completely

The free tier is being discontinued: notice through **2026-09-30**, then 60 days normal access, then 60 days export-only ([`docs/findings.md`](../../findings.md), 2026-08-20, verified against kapitas.se). Do this before the window closes; there is no API and no CSV, so a lapsed account means retyping.

1. **SIE4 ledger export** — Inställningar → Bokföring → **SIE4 Export**. Kapitas emits **one file per räkenskapsår**, with balances and transactions. Take FY1's file.
2. **All 7 PDF reports** — balansrapport, huvudbok, ingående balans, kontoplan, momsrapport, resultatrapport, verifikationslista. They are PDF-only. They are simultaneously your **reconciliation source of truth** (§4) and the **basis for FY1's statutory filings** (§10). Export every one.
3. **Attachments do NOT travel in SIE**, and Kapitas has no documented bulk attachment export (per-voucher retrieval only). Whatever receipts you need are pulled by hand — §5.
4. **Keep the `.se` file's original bytes.** Don't open-and-save it in an editor that re-encodes; the importer auto-detects strict UTF-8 first and falls back to CP437/PC8, and a half-converted file just produces decode warnings.
5. **FY1 has not ended yet.** Today's export is a partial year. Export again after `2026-08-31` and re-import — the second import is keyed by `sie_<series>_<number>` and adds only vouchers that weren't there. **Caveat:** if Kapitas _changes_ a voucher you already imported, the re-import skips it as a duplicate and the change is **not** applied. Track such edits and post a correcting entry (§10).

---

## 2. Set the first fiscal year start BEFORE importing

Inställningar → **Räkenskapsår & moms** (`/settings/fiscal-year`):

- **Räkenskapsårets startmånad** stays `09-01` — the recurring anchor for FY2 onward.
- **Första räkenskapsårets startdatum (valfritt)** = `2025-10-15`. Save.

Why first: this floor raises the `from` of the `fy-`/`ytd` window that _contains_ it, and the same clamp drives the SIE export's `#RAR 0`. Unset, `fy-2025` and the exported `#RAR 0` both start `2025-09-01` — a month and a half before the company existed. Only the containing window moves; FY2 onward and all quarter tokens are untouched.

Calendar-impossible dates (`2025-02-30`) are rejected by the settings contract, so a typo fails loudly rather than skewing every report.

Verify the window, not just the saved field — the reports screen prints the period _label_ ("Räkenskapsår 2025"), never its dates:

```bash
curl -sS "$API_BASE/api/reports/pack?period=fy-2025" -H "authorization: Bearer $TOKEN" | jq .period
# {"token":"fy-2025","kind":"fiscal-year","from":"2025-10-15","to":"2026-08-31"}
```

The other definitive check is the `#RAR 0` line in §9.

---

## 3. Import the SIE file

**UI:** Fånga (`/capture`) → **"Importera SIE-fil"** → pick the file.

The file input filters on `.sie`, `.se`, `text/plain`. If the Kapitas download carries another extension, rename it to `.se` or it won't be selectable.

**Hard bounds** (whole-file rejection → HTTP 422 `sie_import_error`, nothing imported): 32 MiB request body, ≤ 500 vouchers per file, ≤ 100 lines per voucher. FY1 is far under all three; a multi-year file might not be — that's another reason to keep one file per räkenskapsår.

**Read both toasts:**

- Success: `Importerade N verifikat från SIE-filen.` — or `… — M hoppades över.` when vouchers were skipped.
- A second, softer warning toast: the warning **count** plus the **first three** warnings.

**What the toasts do not show:** the per-voucher skip _reasons_, and warnings 4 and beyond. To see the full result, re-run the same import through the API. This is safe — re-import is idempotent:

```bash
curl -sS -X POST "$API_BASE/api/imports/sie" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/octet-stream" \
  --data-binary @FY1.se \
  | jq '{importedVouchers, importedTransactions, skipped, warnings}'
```

On this second run `importedVouchers` is `0` (that is the idempotency proof in §4) while `skipped[]` and `warnings[]` are complete — `warnings[]` is capped at 50 entries plus one `… and N more parse warnings (not shown).` line, so nothing is hidden silently.

### 3.1 Skip reasons — every one must be explained

| `reason`          | Meaning                                                                         |
| ----------------- | ------------------------------------------------------------------------------- |
| `invalid date`    | `#VER` date not `YYYYMMDD` / unparseable.                                       |
| `no transactions` | `#VER` with no `{ … }` block (also warned about by name).                       |
| `invalid amount`  | A `#TRANS` amount that isn't a finite number.                                   |
| `unbalanced`      | Σ amounts ≠ 0 (tolerance 0.005), or the öre-rounded lines don't balance.        |
| `duplicate`       | Same `<series> <number>` twice in the file, or already imported by a prior run. |

A voucher with no `#VER` number falls back to file position: id `sie_<series>_pos<N>`, reference `<series> pos<N>`.

### 3.2 Warning triage

- **`#IB … has a non-zero opening balance`** — opening balances are **never imported** in this version. FY1 is a genuine first fiscal year, so its `#IB` should be zero/absent; a non-zero one means the file isn't the year you think it is. Investigate before trusting any balance. Zero `#IB` rows are silent by design (real files carry one per account).
- **`N character(s) could not be decoded … First affected line: …`** — a CP437 byte outside the mapped subset. `æ/Æ` are mapped; `ø/Ø` are not and produce this warning with the offending line quoted. **Text only** — accounts, amounts and dates are unaffected. Fix the affected voucher texts by hand after import, or re-export as UTF-8 if your Kapitas version offers it.
- **`Ignored non-label line: …` / `Ignored #TRANS outside a #VER block.` / `Ignored '{' without a preceding #VER.` / `Ignored unmatched '}'.` / `#VER … had no transaction block.` / `Unterminated #VER block … — committed as-is.`** — structural. Each is a voucher or fragment that may not have landed intact; check those individually against the verifikationslista.
- **Silently skipped, by design:** every label outside `#SIETYP / #ORGNR / #FNAMN / #KONTO / #VER / #TRANS / #IB` — including `#UB`, `#RES`, `#RAR` and `#KSUMMA`. No warning is emitted for them.

### 3.3 What an imported voucher becomes

A first-class, already-posted row: id `sie_<series>_<number>`, `voucherNumber` = `"<series> <number>"`, `origin: "import"`, `status: "posted"`, `evidencePacketId: null`. It enters the journal, huvudbok, P&L, balance sheet and VAT return exactly like a natively booked voucher, dated by **its own SIE date**, not by import time. It carries **no** review task — it never passed a review decision — so it does not appear in the review queue.

Imported lines carry `vatCode: "NA"` (the SIE 4 subset has no VAT semantics). Phase C's box 05 fix reads the voucher's domestic output-VAT account instead of the line's vatCode, so imported domestic rated sales still report a sales base — see §4.

---

## 4. Reconciliation checklist

Work through this **before** the migrated ledger is trusted for anything statutory. The comparison source is the Kapitas PDF set from §1. Record the actual amounts in your own private notes — they do not belong in this repo.

- [ ] **Voucher count** matches the verifikationslista for FY1:

  ```bash
  curl -sS "$API_BASE/api/workspace" -H "authorization: Bearer $TOKEN" \
    | jq '[.vouchers[] | select(.origin=="import")] | length'
  ```

  Any difference must be fully accounted for by `skipped[]` (§3.1). Zero unexplained gaps.

- [ ] **1930 (bank) closing balance to the öre** at `2026-08-31` versus the balansrapport. Authoritative source: the `#UB 0 1930 …` line of the period-scoped export (§9). Cross-read in the UI at Rapporter → **Balansrapport** with period `fy-2025`.

- [ ] **Every other account's closing balance** versus the balansrapport: walk all `#UB 0 <account> <amount>` lines. Two conventions to hold in your head while comparing: the export is **signed debit-positive** (liabilities, equity and revenue therefore appear negative against the PDF's presentation), and **zero balances are omitted** from the file.

- [ ] **Result accounts** versus the resultatrapport: the `#RES 0 <account> <amount>` lines are the in-window movement of BAS accounts 3xxx–8xxx, same debit-positive convention (revenue is negative).

- [ ] **Trial-balance cross-check** (optional, and **FY1 only**):

  ```bash
  curl -sS "$API_BASE/api/reports/trial-balance?from=2025-10-15&to=2026-08-31" \
    -H "authorization: Bearer $TOKEN" | jq '.[] | {accountNumber, debit, credit, balance}'
  ```

  Böcker → **Råbalans** renders the same numbers. These are window **movement**, not cumulative balances — for FY1 the two coincide because nothing precedes the window. That identity does **not** hold from FY2 onward; use the balance sheet or `#UB` there.

- [ ] **VAT** — Rapporter → period `fy-2025` → **Momsdeklaration** versus Kapitas's momsrapport. Know the semantics before you call a difference a bug (all landed in Phase C):
  - every box is **whole kronor, truncated toward zero**, per box; **box 49** = (10+11+12) + (30+31+32) − 48 computed **from the truncated boxes**, matching how Skatteverket derives it;
  - **box 05** counts revenue-class lines whose own vatCode is rated **or** whose voucher carries a domestic output-VAT line (2610/2620/2630) — the fix that makes imported `vatCode:"NA"` sales consistent; accounts owned by boxes 39/40 are excluded from that inferred arm;
  - **boxes 30–32** are keyed off the reverse-charge output accounts (2614) with their own accumulator; **box 21** is derived from the truncated box-30 family ÷ rate; **box 20** is structurally 0 (no goods-reverse-charge accounts are modeled);
  - **boxes 39/40** are account-based turnover on 3308/3305, vatCode-independent, and deliberately **not** part of box 49;
  - **box 48** covers 2641/2640/2645/2647.

  A `fy-2025` return here is a **reconciliation aid over the fiscal-year window**, not a statutory period declaration — FY1's helårsmoms is filed from Kapitas's momsrapport (§10).

- [ ] **Five vouchers compared line by line** — §8.

- [ ] **Idempotency proven**: the re-run in §3 reported `importedVouchers: 0` and created no new rows.

---

## 5. Receipt pull → bulk capture

1. Export the ~70-receipt backlog out of Drive/Gmail (or wherever it lives) into **one local folder**.
2. Fånga (`/capture`) → drag the whole folder onto the drop-zone, or click it and multi-select. Accepted: `image/*` and `application/pdf`, ≤ 16 MB each. Anything else is rejected per file with its own toast, and the rest of the drop continues.
3. **Expect minutes, not seconds — budget ~4–5 minutes for a 70-file drop.** Promotion runs at most **4 pipelines in flight**, and each receipt spends **3 calls from the 60-per-minute per-subject mutation budget** (`uploads/init` → `evidence` → `extract`; the blob PUT is JWT-exempt in local-blob mode, so it keys into a separate address bucket, also 60/min, and goes direct to Azure in a hosted deployment). That caps sustained throughput at roughly **20 receipts/minute**, and a batch that exhausts the window waits it out: a 429 is retried up to 3 times honoring `Retry-After` / `RateLimit: reset=`, capped at 65 s so a bogus header can't park the client for an hour. The drop paces itself; you do **not** need to feed it in small batches.
4. Keep the tab open until the drafts table drains. A draft that fails can be re-promoted from the drafts table — it joins the in-flight run rather than starting a second pipeline, and server-side `(workspace, sha256, sizeBytes)` dedupe absorbs any that slip through from another tab.
5. **Local-blob limitation:** live OCR cannot read local-disk blobs (SELF_HOST "Known limitation"), so extracted fields stay empty in a local normal-mode instance. That does not block anything below — attach works on the evidence row, not on its extraction.

---

## 6. Stop — reject the auto-created review tasks

**This step prevents double-booking FY1. Do not skip it.**

Every promoted receipt runs the normal capture pipeline, which creates its own **draft voucher + review task**. For a receipt whose voucher Kapitas already booked (and you just imported), that draft is a duplicate. Approving it would post a **second** voucher for the same business event.

- Go to Idag → review queue (`/today?view=queue`). For every receipt that belongs to an already-imported FY1 voucher, choose **"Avvisa"** (reject). Rejection resolves the review and marks the draft voucher `rejected`; it appends **no** ledger lines, so the books are untouched.
- Then attach the evidence to the _imported_ voucher (§7). The attach is independent of the rejected draft — it creates a new packet pointing at the imported voucher.
- Approve a review **only** when the receipt is genuinely not in the imported ledger (something Kapitas never booked).

Cosmetic and known: V-numbers are assigned at intake, so rejected drafts leave gaps in the `V-` sequence (readiness G8). Harmless for migrated history.

---

## 7. Attach receipts to imported vouchers (API)

Today this is an API call. The evidence-detail **"attach to voucher" picker is Phase E (Books UI) and is not built yet** — `composeEvidence` currently has no caller anywhere in the web app. The route below is the supported path, not a workaround: it is exactly what the Phase E picker will call.

Find the ids:

```bash
# imported vouchers: id, "<series> <number>", status
curl -sS "$API_BASE/api/workspace" -H "authorization: Bearer $TOKEN" \
  | jq -r '.vouchers[] | select(.origin=="import") | [.id, .voucherNumber, .status] | @tsv'

# evidence: id, title
curl -sS "$API_BASE/api/workspace" -H "authorization: Bearer $TOKEN" \
  | jq -r '.evidence[] | [.id, .title] | @tsv'
```

The voucher id is `sie_<series>_<number>` — the same series+number the journal chip shows (`A 42` → `sie_A_42`; a numberless source voucher is `sie_A_pos7`). An evidence id also appears in its detail URL, `/capture/evidence/<id>`.

Attach:

```bash
curl -sS -X POST "$API_BASE/api/evidence/compose" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"evidenceIds":["<evidence id>"],"targetVoucherId":"sie_A_42"}'
```

- `201` → a new packet is created, `voucher.evidencePacketId` is repointed, and one `EvidenceRelinked` event lands on the hash chain (the relink is chain-visible, never a silent read-model edit).
- `404` with `"code":"voucher_not_found"` → the id names no voucher in this workspace, and **nothing was written** — the target is validated before any mutation.
- Several receipts for one voucher: pass them all in **one** call's `evidenceIds`. Packets are never edited in place, so a second call creates a second packet and replaces the link — the first packet's receipts would drop off the voucher.

Verify an attach: open `/capture/evidence/<id>` — the links section now names the imported voucher, and in Böcker → Journal that voucher's chip becomes a link that keeps its **Importerad** badge.

---

## 8. Spot-check protocol — five vouchers, line by line

Pick five deliberately: a large one, a small one, one with Nordic characters in its text, one with many lines, and one that has a receipt attached. For each:

1. **Böcker → Journal** (`/books?view=journal&period=fy-2025`): the chip shows the real `"<series> <number>"` with the **Importerad** badge — never a raw `sie_…` id once the voucher row exists.
2. Compare **every line** — account, debit/credit, date, text — against the Kapitas verifikationslista entry. A mismatch confined to a Nordic character is the decode warning from §3.2, not a posting error.
3. Confirm the date is the **voucher's own date** (business event), not the import day.
4. Open the attached evidence and confirm amount, date and counterparty match the voucher.

---

## 9. Final SIE re-export sanity check

```bash
curl -sS "$API_BASE/api/exports/sie?period=fy-2025" \
  -H "authorization: Bearer $TOKEN" -o fy-2025.se

iconv -f CP437 -t UTF-8 fy-2025.se | head -40
```

Rapporter → **"Exportera SIE"** with `fy-2025` selected downloads the same bytes (named `jpx-export-fy-2025.se`). The file is **CP437/PC8, not UTF-8** — never re-save it as UTF-8. If `iconv` isn't on your PATH, open the file in an editor with the encoding set to IBM437/CP437 instead; the ASCII-range labels (`#RAR`, `#UB`, account numbers, amounts) are readable either way.

Confirm:

- `#RAR 0 20251015 20260831` — the clamped window. Unclamped (i.e. §2 not done) it reads `20250901`, and that is legally wrong for FY1.
- `#IB 0 …` lines: for a genuine first fiscal year there should be **none** (nothing precedes the window; zero balances are dropped).
- `#UB 0 …` and `#RES 0 …` present and matching what you reconciled in §4.
- `#SIETYP 4`, plus `#ORGNR` / `#FNAMN` — these come from company settings, so fill them in at `/settings/company` first if they're missing.

Two caveats before this file goes anywhere:

- **The export re-numbers vouchers.** Every `#VER` is emitted as series `A` with a fresh sequential number in journal order; the original Kapitas series/numbers live on in this product's journal but are **not** carried into the exported file. Say so when handing the file to a revisor or an årsredovisning tool that expects cross-references.
- **Never re-import an export into the live workspace** to "prove it parses". The re-numbered ids (`sie_A_1`, `sie_A_2`, …) collide only partially with what is already there — the colliding ones are skipped as duplicates and the rest **double-book**. Prove round-tripping against a throwaway workspace instead (e.g. a demo-mode dev server, whose store is memory-only).

For reference: the full-history export (no `?period=`) is unchanged by Phase D — no `#IB`/`#UB`/`#RES`, and `#RAR 0` derived from the fiscal window containing today (still clamped by `firstFiscalYearStart`).

---

## 10. What this migration deliberately does not do

- **FY1's statutory close stays outside the product.** Produce the årsredovisning/INK2 in an external tool fed by the Kapitas SIE4 file plus the PDF set, and file FY1's helårsmoms from Kapitas's momsrapport. This product holds FY1 for continuity, attachable evidence and reporting — and runs FY2 from day 1. (Readiness spec, "FY1 recommendation".)
- **Opening balances are never imported** — `#IB` is recognized only to warn (§3.2). There is no opening-balance concept in the domain yet; for FY1 there is nothing to carry.
- **No period lock and no correction flow yet.** A wrong imported voucher is fixed by posting a _correcting_ entry, never by editing history: `POST /api/vouchers/manual` (`description`, `bookedAt`, 2–100 balanced `lines`; API-only — the form is a later phase). It creates a voucher plus a review task, so it posts only once you approve it in the queue.
- **Kapitas attachments are not bulk-exportable** (vendor: per-voucher retrieval only) — §5's folder is manual work, and it is the reason to do it before the account lapses.
