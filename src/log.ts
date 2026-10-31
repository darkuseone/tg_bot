export function log(
  level: "info" | "error",
  message: string,
  fields?: Record<string, string | number | boolean | null>,
): void {
  const line = JSON.stringify({ level, message, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export function safeError(error: unknown): string {
  const text = error instanceof Error ? error.message : "unknown";
  if (text.includes("api.telegram.org") || /\d{6,}:[A-Za-z0-9_-]{20,}/.test(text)) {
    return "request failed";
  }
  return text.slice(0, 300);
}
