import { ValidationError } from "./errors";

/**
 * 必須フィールドを検証
 */
export function validateRequired<T extends Record<string, unknown>>(
  obj: T,
  fields: (keyof T)[]
): void {
  for (const field of fields) {
    if (obj[field] === undefined || obj[field] === null || obj[field] === "") {
      throw new ValidationError(`Missing required field: ${String(field)}`);
    }
  }
}

/**
 * UUID を検証
 */
export function validateUUID(value: string): boolean {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidPattern.test(value);
}
