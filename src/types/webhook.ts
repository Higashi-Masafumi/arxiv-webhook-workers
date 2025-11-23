/**
 * Webhook ペイロード
 */
export interface WebhookPayload extends Record<string, unknown> {
  workspace_id: string;
  page_id: string;
  link: string;
}

/**
 * Webhook レスポンス
 */
export interface WebhookResponse {
  success: boolean;
  page_id: string;
  updated_at: string;
}
