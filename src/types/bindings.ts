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
