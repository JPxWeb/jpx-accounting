/**
 * Maps a workspace profile locale (BCP-47, e.g. "sv-SE") to a message-catalog
 * locale. `en` is the source catalog; only Swedish has a translation today.
 */
export function messagesLocale(profileLocale: string | undefined): "en" | "sv" {
  return profileLocale?.toLowerCase().startsWith("sv") ? "sv" : "en";
}
