/**
 * Isomorphic SHA-256 helper. Uses Web Crypto (`crypto.subtle`), which exists in browsers
 * (secure contexts), Node >= 20, and workers — so the same function serves the client
 * pipeline and any server-side callers.
 *
 * Returns `undefined` instead of throwing when the runtime has no usable SubtleCrypto
 * (e.g. plain-HTTP LAN previews where `crypto.subtle` is withheld): capture must degrade
 * to the server-side fallback hash rather than fail the whole promotion.
 */
export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string | undefined> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return undefined;
  }

  try {
    const digest = await subtle.digest("SHA-256", data as BufferSource);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return undefined;
  }
}
