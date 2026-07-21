/**
 * Hash-chain primitives for the append-only event ledger (WS-B R14).
 *
 * Every appended event carries `eventHash = buildEventHash(previousHash,
 * payload)` — SHA-256 over the canonical serialization of the
 * `(previousHash, payload)` pair. Canonicalization (`canonicalJson`) is the
 * ONE serializer used both at append time and when re-verifying, which is
 * what makes payload recomputation possible at all: Postgres stores payloads
 * as `jsonb` (key order normalized, whitespace dropped), so any hash built
 * over an ad-hoc `JSON.stringify(payload)` is unrecoverable after a round
 * trip. Hashing the *parsed value* through `canonicalJson` is byte-stable
 * across the jsonb round trip and across both `LedgerStore` implementations.
 *
 * Scheme history (see `integrity.ts` for the verification cutover rule):
 *
 * - **Legacy djb2** (`h_` + 8 lowercase hex chars): the original 32-bit
 *   non-cryptographic scheme. Persisted chains created before the SHA-256
 *   cutover carry these hashes forever (the ledger is append-only — no
 *   rewrite migration). Retained here only for scheme detection and tests.
 * - **SHA-256** (`sha256_` + 64 lowercase hex chars): every new append.
 *
 * This module is bundled into the browser (the api-client demo fallback
 * constructs `MemoryLedgerStore` client-side), so it must stay synchronous
 * and dependency-free: `node:crypto` is unavailable in the web bundle and
 * WebCrypto's digest is async-only. The SHA-256 implementation below is
 * pure TypeScript (FIPS 180-4) and is pinned byte-identical to
 * `node:crypto`'s `createHash("sha256")` by `tests/unit/hash-chain.test.ts`.
 */

// ---------------------------------------------------------------------------
// Canonical JSON serialization
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON serialization: `JSON.stringify` semantics with object
 * keys sorted (by UTF-16 code unit) at every depth.
 *
 * Guarantees, mirroring `JSON.stringify` so values survive a
 * stringify→jsonb→parse round trip unchanged:
 *
 * - object keys sorted recursively; array order preserved
 * - `undefined`/function/symbol properties dropped; as array elements → `null`
 * - non-finite numbers (`NaN`, `±Infinity`) → `null`; `-0` → `"0"`; finite
 *   numbers use the shortest-round-trip form `JSON.stringify` emits
 * - `toJSON()` honored (`Date` → ISO string)
 * - strings escaped exactly as `JSON.stringify` escapes them (well-formed:
 *   lone surrogates become `\udXXX` escapes, so the output never contains
 *   unpaired surrogates)
 *
 * For any JSON-safe value: `canonicalJson(JSON.parse(canonicalJson(v)))`
 * equals `canonicalJson(v)` — the property event-hash re-verification
 * depends on. Cyclic values throw, as with `JSON.stringify`.
 */
export function canonicalJson(value: unknown): string {
  return serializeCanonical(value) ?? "null";
}

function serializeCanonical(value: unknown): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "undefined":
    case "function":
    case "symbol":
      // Mirror JSON.stringify: omitted as an object property; callers treat
      // `undefined` as `null` in array positions and at the top level.
      return undefined;
    case "number":
      // JSON.stringify maps non-finite numbers to "null" and prints finite
      // doubles in shortest-round-trip form — both deterministic.
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "bigint":
      throw new TypeError("canonicalJson: BigInt values are not JSON-serializable");
    default: {
      const objectValue = value as object & { toJSON?: unknown };
      if (typeof objectValue.toJSON === "function") {
        return serializeCanonical((objectValue as { toJSON: () => unknown }).toJSON());
      }
      if (Array.isArray(objectValue)) {
        const items = objectValue.map((item) => serializeCanonical(item) ?? "null");
        return `[${items.join(",")}]`;
      }
      const record = objectValue as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const serialized = serializeCanonical(record[key]);
        if (serialized !== undefined) parts.push(`${JSON.stringify(key)}:${serialized}`);
      }
      return `{${parts.join(",")}}`;
    }
  }
}

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4) — pure, synchronous, isomorphic
// ---------------------------------------------------------------------------

const UTF8_ENCODER = new TextEncoder();

/** First 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

function rotr(word: number, bits: number): number {
  return (word >>> bits) | (word << (32 - bits));
}

/**
 * SHA-256 of a string's UTF-8 bytes, as 64 lowercase hex chars. Pinned
 * byte-identical to `createHash("sha256").update(input, "utf8")` by unit
 * tests (kept dependency-free because this package is browser-bundled).
 */
export function sha256Hex(input: string): string {
  const data = UTF8_ENCODER.encode(input);
  const bitLength = data.length * 8;

  // Pad to 56 (mod 64) bytes, then append the 64-bit big-endian bit length.
  const paddedLength = (((data.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  // Fractional parts of the square roots of the first 8 primes.
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let t = 0; t < 16; t += 1) schedule[t] = view.getUint32(offset + t * 4, false);
    for (let t = 16; t < 64; t += 1) {
      const w15 = schedule[t - 15]!;
      const w2 = schedule[t - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      schedule[t] = (schedule[t - 16]! + s0 + schedule[t - 7]! + s1) | 0;
    }

    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;

    for (let t = 0; t < 64; t += 1) {
      const bigS1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + bigS1 + ch + SHA256_K[t]! + schedule[t]!) | 0;
      const bigS0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (bigS0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    state[0] = (state[0]! + a) | 0;
    state[1] = (state[1]! + b) | 0;
    state[2] = (state[2]! + c) | 0;
    state[3] = (state[3]! + d) | 0;
    state[4] = (state[4]! + e) | 0;
    state[5] = (state[5]! + f) | 0;
    state[6] = (state[6]! + g) | 0;
    state[7] = (state[7]! + h) | 0;
  }

  let hex = "";
  for (let index = 0; index < 8; index += 1) {
    hex += state[index]!.toString(16).padStart(8, "0");
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Event-hash schemes
// ---------------------------------------------------------------------------

/** `sha256_` + 64 lowercase hex chars — every post-cutover append. */
export const SHA256_EVENT_HASH_PATTERN = /^sha256_[0-9a-f]{64}$/;

/** `h_` + 8 lowercase hex chars — the legacy djb2 scheme (pre-cutover chains). */
export const LEGACY_DJB2_EVENT_HASH_PATTERN = /^h_[0-9a-f]{8}$/;

export type EventHashScheme = "sha256" | "djb2" | "unknown";

/**
 * Classify a persisted `eventHash` by the scheme that produced it. The two
 * formats are disjoint by construction (`sha256_` prefix + 64 hex vs `h_`
 * prefix + 8 hex); anything else was not produced by any honest append and
 * is treated as tampering by the integrity verifier.
 */
export function detectEventHashScheme(hash: string): EventHashScheme {
  if (SHA256_EVENT_HASH_PATTERN.test(hash)) return "sha256";
  if (LEGACY_DJB2_EVENT_HASH_PATTERN.test(hash)) return "djb2";
  return "unknown";
}

/**
 * Chain-link hash for a new event: SHA-256 over the canonical serialization
 * of the `(previousHash, payload)` pair. `payload` is the RAW payload value
 * (not a pre-serialized string) — serialization happens in here, through
 * `canonicalJson`, so append-time hashing and re-verification can never
 * disagree on byte layout. Both `MemoryLedgerStore` and
 * `PostgresLedgerStore` MUST call this one function (store parity, Rule 11).
 */
export function buildEventHash(previousHash: string, payload: unknown): string {
  return `sha256_${sha256Hex(canonicalJson({ payload, previousHash }))}`;
}

// ---------------------------------------------------------------------------
// Legacy djb2 scheme (pre-cutover chains only — never used for new appends)
// ---------------------------------------------------------------------------

/**
 * The original 32-bit djb2-xor hash (`h_` + 8 hex chars).
 *
 * @deprecated Never hash new data with this. It survives only because
 * persisted pre-cutover chains reference it and tests/forensics need to
 * reproduce historical values.
 */
export function hashValue(value: string) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return `h_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * The exact event-hash construction used by pre-cutover appends:
 * `djb2(previousHash + ":" + JSON.stringify(payload))`. Exported so tests
 * can fabricate faithful legacy chains; `serializedPayload` is the
 * append-time `JSON.stringify` output, whose key order is unrecoverable
 * after a jsonb round trip — which is exactly why legacy links are verified
 * by linkage only (see `integrity.ts`).
 *
 * @deprecated Never hash new data with this.
 */
export function legacyDjb2EventHash(previousHash: string, serializedPayload: string) {
  return hashValue(`${previousHash}:${serializedPayload}`);
}
