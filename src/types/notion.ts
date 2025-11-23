/**
 * Notion OAuth トークンレスポンス
 * @see https://developers.notion.com/docs/authorization
 */
export interface NotionOAuthTokenResponse {
  access_token: string;
  refresh_token: string; // トークンリフレッシュ用
  token_type: "bearer";
  bot_id: string;
  workspace_id: string;
  workspace_name: string | null;
  workspace_icon: string | null;
  owner: {
    type: "user" | "workspace";
    user?: {
      object: "user";
      id: string;
    };
  };
  duplicated_template_id: string | null; // テンプレート複製時のページ ID
  request_id: string;
}

/**
 * Notion トークンリフレッシュレスポンス
 * @see https://developers.notion.com/reference/refresh-a-token
 */
export interface NotionRefreshTokenResponse {
  access_token: string;
  refresh_token: string; // 新しい refresh_token
  bot_id: string;
  workspace_id: string;
  workspace_name: string | null;
}

/**
 * ArXiv 論文データ
 */
export interface ArxivPaper {
  title: string;
  authors: string[];
  summary: string;
  link: string;
  publishedYear: number;
}

