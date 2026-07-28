/**
 * 外部 API / 論文ページ取得の共通 HTTP クライアント
 *
 * ArXiv・Crossref・OpenAlex・IEEE いずれもレート制限を返してくるため、
 * タイムアウトと 429 / 5xx リトライを 1 箇所にまとめる。
 */

export interface FetchOptions {
  /** リクエストごとのタイムアウト（ミリ秒） */
  timeoutMs?: number;
  /** リトライ回数（初回は含まない） */
  maxRetries?: number;
  /** Retry-After が無い場合の指数バックオフ基準値（ミリ秒） */
  baseRetryDelayMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_RETRY_DELAY_MS = 1000;
/** Retry-After をそのまま信用すると Workers の実行時間上限に当たるため上限を設ける */
const MAX_RETRY_DELAY_MS = 15000;

/**
 * 429 / 5xx を指数バックオフでリトライしつつ fetch する
 *
 * レスポンスは status を見て呼び出し側が判断する（404 を正常系として扱いたい場面があるため、
 * ここでは ok 以外を一律に例外化しない）
 */
export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    baseRetryDelayMs = DEFAULT_BASE_RETRY_DELAY_MS,
    headers,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, timeoutMs, headers);

      if (isRetryableStatus(response.status) && attempt < maxRetries) {
        await sleep(retryDelayMs(response, baseRetryDelayMs, attempt));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      await sleep(Math.min(baseRetryDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function retryDelayMs(response: Response, baseDelayMs: number, attempt: number): number {
  const retryAfter = Number.parseInt(response.headers.get("Retry-After") ?? "", 10);
  const delay = Number.isFinite(retryAfter)
    ? retryAfter * 1000
    : baseDelayMs * 2 ** attempt;
  return Math.min(Math.max(delay, 0), MAX_RETRY_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * レスポンス本文を上限バイト数まで読む
 *
 * 論文ページには数 MB のものもあり、必要なのは <head> の meta タグだけなので
 * 全文をメモリに載せない。
 */
export async function readTextCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let received = 0;

  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    // 上限で打ち切った場合に接続を解放する
    await reader.cancel().catch(() => undefined);
  }

  return text;
}
