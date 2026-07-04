/**
 * SIE 4E/4I subset parser (advisory pivot Phase 3, Task 3.4).
 *
 * Supported labels: `#SIETYP`, `#ORGNR`, `#FNAMN`, `#KONTO`, and
 * `#VER series [number] date [text]` with a `{ … }` block of
 * `#TRANS account {objects-ignored} amount [transdate] [text]` lines.
 * Unknown labels are skipped; bare `#TRANS` lines outside a `#VER` block are
 * ignored with a warning (real files never have them — the old placeholder
 * E2E fixture did).
 */

export type SieTransaction = {
  account: string;
  /** Signed amount, SIE convention: debit positive, credit negative. NaN when unparseable — importSie skips the voucher. */
  amount: number;
  transDate?: string | undefined;
  text?: string | undefined;
};

export type SieVoucher = {
  series: string;
  /** Voucher number within the series. Optional per spec. */
  number?: string | undefined;
  /** ISO `YYYY-MM-DD` when the source was a valid `YYYYMMDD`; raw token otherwise (importSie validates). */
  date: string;
  text?: string | undefined;
  transactions: SieTransaction[];
};

export type ParsedSieFile = {
  sieType?: string | undefined;
  orgNumber?: string | undefined;
  companyName?: string | undefined;
  /** `#KONTO` account number → name. */
  accounts: Record<string, string>;
  vouchers: SieVoucher[];
  warnings: string[];
};

type SieToken = { kind: "field"; value: string } | { kind: "objects"; value: string };

/**
 * Tokenize one SIE line: whitespace-separated fields, `"…"` quoted strings
 * with `\"` / `\\` escapes, and `{ … }` object lists (quote-aware) collapsed
 * into a single ignorable token.
 */
function tokenizeLine(line: string): SieToken[] {
  const tokens: SieToken[] = [];
  let index = 0;

  const readQuoted = (): string => {
    // Caller sits on the opening quote.
    index += 1;
    let value = "";
    while (index < line.length) {
      const char = line[index]!;
      if (char === "\\" && index + 1 < line.length) {
        value += line[index + 1]!;
        index += 2;
        continue;
      }
      if (char === '"') {
        index += 1;
        break;
      }
      value += char;
      index += 1;
    }
    return value;
  };

  while (index < line.length) {
    const char = line[index]!;
    if (char === " " || char === "\t" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === '"') {
      tokens.push({ kind: "field", value: readQuoted() });
      continue;
    }
    if (char === "{") {
      // Object/dimension list — consumed (quote-aware) and ignored by this subset.
      index += 1;
      let depth = 1;
      let value = "";
      while (index < line.length && depth > 0) {
        const inner = line[index]!;
        if (inner === '"') {
          value += `"${readQuoted()}"`;
          continue;
        }
        if (inner === "{") depth += 1;
        if (inner === "}") {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
        value += inner;
        index += 1;
      }
      tokens.push({ kind: "objects", value: value.trim() });
      continue;
    }
    let value = "";
    while (index < line.length) {
      const inner = line[index]!;
      if (inner === " " || inner === "\t" || inner === "\r" || inner === "{" || inner === "}") break;
      value += inner;
      index += 1;
    }
    tokens.push({ kind: "field", value });
  }

  return tokens;
}

function toIsoDate(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (!/^\d{8}$/.test(raw)) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function parseSie(content: string): ParsedSieFile {
  const accounts: Record<string, string> = {};
  const vouchers: SieVoucher[] = [];
  const warnings: string[] = [];
  let sieType: string | undefined;
  let orgNumber: string | undefined;
  let companyName: string | undefined;

  // #VER state machine: a `#VER` line arms `pendingVoucher`; the `{ … }`
  // block collects its transactions; `}` commits it.
  let pendingVoucher: SieVoucher | undefined;
  let inBlock = false;

  const commitPending = () => {
    if (!pendingVoucher) return;
    vouchers.push(pendingVoucher);
    pendingVoucher = undefined;
    inBlock = false;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line.length === 0) continue;

    if (line === "{") {
      if (pendingVoucher) {
        inBlock = true;
      } else {
        warnings.push("Ignored '{' without a preceding #VER.");
      }
      continue;
    }
    if (line === "}") {
      if (pendingVoucher && inBlock) {
        commitPending();
      } else {
        warnings.push("Ignored unmatched '}'.");
      }
      continue;
    }
    if (!line.startsWith("#")) {
      warnings.push(`Ignored non-label line: ${line.slice(0, 40)}`);
      continue;
    }

    // Accept `{` trailing a #VER line as the block opener (lenient superset of
    // the spec's `{`-on-its-own-line form).
    let opensBlock = false;
    if (/^#VER\b/i.test(line) && line.endsWith("{")) {
      opensBlock = true;
      line = line.slice(0, -1).trimEnd();
    }

    const tokens = tokenizeLine(line);
    const fields = tokens.filter((token): token is SieToken & { kind: "field" } => token.kind === "field");
    const label = fields[0]?.value.toUpperCase();

    switch (label) {
      case "#SIETYP":
        sieType = fields[1]?.value;
        break;
      case "#ORGNR":
        orgNumber = fields[1]?.value;
        break;
      case "#FNAMN":
        companyName = fields[1]?.value;
        break;
      case "#KONTO": {
        const number = fields[1]?.value;
        if (number) accounts[number] = fields[2]?.value ?? "";
        break;
      }
      case "#VER": {
        if (pendingVoucher) {
          // Previous #VER never opened a block — commit it as-is (importSie
          // will skip it as "no transactions") instead of silently dropping.
          warnings.push(`#VER ${pendingVoucher.series} ${pendingVoucher.number ?? ""} had no transaction block.`);
          commitPending();
        }
        const series = fields[1]?.value ?? "";
        // `number` is optional: when the second value is already an 8-digit
        // date, the number was omitted.
        const second = fields[2]?.value;
        let number: string | undefined;
        let dateRaw: string | undefined;
        let text: string | undefined;
        if (second !== undefined && /^\d{8}$/.test(second)) {
          dateRaw = second;
          text = fields[3]?.value;
        } else {
          number = second;
          dateRaw = fields[3]?.value;
          text = fields[4]?.value;
        }
        pendingVoucher = {
          series,
          number,
          date: toIsoDate(dateRaw) ?? "",
          text,
          transactions: [],
        };
        inBlock = opensBlock;
        break;
      }
      case "#TRANS": {
        if (!pendingVoucher || !inBlock) {
          warnings.push("Ignored #TRANS outside a #VER block.");
          break;
        }
        const account = fields[1]?.value ?? "";
        const amountRaw = fields[2]?.value;
        // NaN survives into the voucher on purpose: importSie skips the whole
        // voucher ("invalid amount") instead of importing a partial one.
        const amount = amountRaw === undefined ? Number.NaN : Number.parseFloat(amountRaw);
        const third = fields[3]?.value;
        const transDate = third !== undefined && /^\d{8}$/.test(third) ? toIsoDate(third) : undefined;
        const text = transDate !== undefined ? fields[4]?.value : third;
        pendingVoucher.transactions.push({ account, amount, transDate, text });
        break;
      }
      default:
        // Unknown labels are skipped per the subset contract.
        break;
    }
  }

  if (pendingVoucher) {
    warnings.push(
      inBlock
        ? `Unterminated #VER block for ${pendingVoucher.series} ${pendingVoucher.number ?? ""} — committed as-is.`
        : `#VER ${pendingVoucher.series} ${pendingVoucher.number ?? ""} had no transaction block.`,
    );
    commitPending();
  }

  return { sieType, orgNumber, companyName, accounts, vouchers, warnings };
}
