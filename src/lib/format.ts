export function nowIso(): string {
  return new Date().toISOString();
}

export function humanTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function splitCsv(input?: string): string[] {
  if (!input) return [];
  return input.split(',').map((x) => x.trim()).filter(Boolean);
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
