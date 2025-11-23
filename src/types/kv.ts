/**
 * OAuth State データ（KV に保存）
 * Key: state:{state}
 * TTL: 600秒
 */
export interface OAuthState {
  createdAt: number; // Unix timestamp (ms)
}

/**
 * KV キー生成ヘルパー
 */
export const KVKeys = {
  oauthState: (state: string) => `state:${state}`,
} as const;

