/**
 * PC8 (IBM CP437) encoding for SIE files — the SIE 4 spec mandates
 * `#FORMAT PC8`. We map the ASCII range 1:1 plus the Swedish/CP437 subset the
 * spec actually needs; anything else encodes as `?` (and decodes as U+FFFD)
 * rather than silently mangling bytes.
 */

/** Unicode → CP437 byte for the non-ASCII characters SIE cares about. */
const UNICODE_TO_CP437: Record<string, number> = {
  å: 0x86,
  ä: 0x84,
  ö: 0x94,
  Å: 0x8f,
  Ä: 0x8e,
  Ö: 0x99,
  é: 0x82,
  É: 0x90,
  ü: 0x81,
  Ü: 0x9a,
  æ: 0x91,
  Æ: 0x92,
};

const CP437_TO_UNICODE = new Map<number, string>(Object.entries(UNICODE_TO_CP437).map(([char, byte]) => [byte, char]));

const QUESTION_MARK = 0x3f;
const REPLACEMENT_CHARACTER = "�";

/** Encode text as PC8/CP437 bytes. Unmappable characters become `?`. */
export function encodePc8(text: string): Uint8Array<ArrayBuffer> {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code <= 0x7f) {
      bytes.push(code);
      continue;
    }
    bytes.push(UNICODE_TO_CP437[char] ?? QUESTION_MARK);
  }
  return new Uint8Array(bytes);
}

/** Decode PC8/CP437 bytes. Unmapped high bytes become U+FFFD. */
export function decodePc8(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) {
    if (byte <= 0x7f) {
      text += String.fromCharCode(byte);
      continue;
    }
    text += CP437_TO_UNICODE.get(byte) ?? REPLACEMENT_CHARACTER;
  }
  return text;
}

/**
 * Decode an incoming SIE buffer: strict UTF-8 first (modern tooling exports
 * UTF-8 despite the spec), CP437 subset map when the bytes are not valid
 * UTF-8. The CP437 bytes we map (0x81–0x9A) are never valid standalone UTF-8,
 * so genuine PC8 files reliably fall through to the CP437 branch.
 */
export function decodeSieBuffer(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return decodePc8(bytes);
  }
}

/** Longest excerpt of an affected line echoed back in a decode warning (bounded — CONVENTIONS Rule 25). */
const DECODE_WARNING_EXCERPT_CHARS = 40;

/**
 * Detect CP437 decode fallout: a byte outside this subset's map (e.g. ø/Ø,
 * which have no CP437 slot here) decodes to U+FFFD instead of the real
 * character. Callers merge this into `ParsedSieFile.warnings` so a garbled
 * voucher text is surfaced, not silent (readiness G11). The first affected
 * line is quoted (bounded excerpt) so "review manually" has somewhere to point.
 */
export function sieDecodeWarnings(text: string): string[] {
  const replacementCount = [...text].filter((char) => char === REPLACEMENT_CHARACTER).length;
  if (replacementCount === 0) return [];
  const firstAffected =
    text
      .split(/\r?\n/)
      .find((line) => line.includes(REPLACEMENT_CHARACTER))
      ?.trim() ?? "";
  const excerpt =
    firstAffected.length > DECODE_WARNING_EXCERPT_CHARS
      ? `${firstAffected.slice(0, DECODE_WARNING_EXCERPT_CHARS)}…`
      : firstAffected;
  return [
    `${replacementCount} character(s) could not be decoded (a PC8/CP437 byte outside this subset's map, e.g. ø/Ø) and were replaced with "${REPLACEMENT_CHARACTER}" — review affected voucher texts manually. First affected line: ${excerpt}`,
  ];
}
