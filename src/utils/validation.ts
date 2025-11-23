import { ValidationError } from "./errors";

/**
 * ArXiv URL のパターン
 */
const ARXIV_URL_PATTERN =
  /arxiv\.org\/(abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?(\.pdf)?/;

/**
 * ArXiv URL を検証
 */
export function validateArxivUrl(url: string): boolean {
  return ARXIV_URL_PATTERN.test(url);
}

/**
 * ArXiv ID を抽出
 */
export function extractArxivId(url: string): string {
  const match = url.match(/arxiv\.org\/(abs|pdf)\/(\d{4}\.\d{4,5})/);
  if (!match) {
    throw new ValidationError(`Invalid ArXiv URL: ${url}`);
  }
  return match[2];
}

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
