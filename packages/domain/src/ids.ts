export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
