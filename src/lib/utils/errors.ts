/** Formats an unknown error for storage/display, masking credential-looking text. */
export function cleanErrorMessage(error: unknown, maxLength = 1500): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/:\/\/[^/\s@]+@/g, "://***@")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 ***")
    .replace(/([?&](?:token|access_token|api_key|apikey|key|password|secret)=)[^&\s]+/gi, "$1***")
    .slice(0, maxLength);
}
