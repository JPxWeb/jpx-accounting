export function hashValue(value: string) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return `h_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildEventHash(previousHash: string, payload: string) {
  return hashValue(`${previousHash}:${payload}`);
}
