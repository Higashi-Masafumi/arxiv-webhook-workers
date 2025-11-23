/**
 * Cloudflare Workers Scheduled Event
 * @see https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
 */
export interface ScheduledEvent {
  type: "scheduled";
  scheduledTime: number; // Unix timestamp (ms)
  cron: string; // Cron expression
}

/**
 * Cron Job の実行結果
 */
export interface CronJobResult {
  jobName: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  duration: number; // ミリ秒
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * リフレッシュ結果
 */
export interface RefreshResult {
  total: number; // 対象トークン数
  success: number; // 成功数
  failed: number; // 失敗数
  errors: RefreshError[]; // エラー詳細
}

/**
 * リフレッシュエラー
 */
export interface RefreshError {
  botId: string;
  workspaceId: string;
  error: string;
  timestamp: string; // ISO 8601
}

