export function nowIso(): string {
  return new Date().toISOString();
}

export function humanTime(iso: string): string {
  const date = new Date(iso);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function splitCsv(input?: string): string[] {
  if (!input) return [];
  return input.split(',').map((x) => x.trim()).filter(Boolean);
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
