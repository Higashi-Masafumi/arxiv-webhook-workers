/**
 * Cloudflare Workers の環境変数とバインディング
 */
export interface Bindings {
  // D1 Database
  arxiv_notion_db: D1Database;

  // KV Namespace
  KV: KVNamespace;

  // 環境変数
  NOTION_CLIENT_ID: string;
  NOTION_CLIENT_SECRET: string;
  WORKER_URL: string;

  // オプション環境変数
  LOG_LEVEL?: "debug" | "info" | "warn" | "error";
  ARXIV_API_TIMEOUT?: string; // ミリ秒（文字列）
  NOTION_API_TIMEOUT?: string; // ミリ秒（文字列）

  /**
   * IEEE Xplore Metadata API キー（Secret）
   * 未設定でも IEEE 論文ページの HTML から取得を試みるが、
   * bot 対策でブロックされることがあるため設定を推奨
   * @see https://developer.ieee.org/
   */
  IEEE_API_KEY?: string;

  /**
   * Crossref / OpenAlex の "polite pool" に載せるための連絡先メールアドレス
   * 設定するとレート制限が緩和され、障害時に連絡が来る
   */
  CONTACT_EMAIL?: string;
}

/**
 * Hono コンテキストの型定義
 */
export type HonoEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

/**
 * Hono Variables（リクエストスコープの変数）
 */
export interface Variables {
  requestId?: string;
  startTime?: number;
}
