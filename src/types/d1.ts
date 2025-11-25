/**
 * Workspace テーブルのレコード型
 */
export interface Workspace {
  id: string; // workspace_id
  workspace_name: string | null;
  workspace_icon: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * Integration テーブルのレコード型
 */
export interface Integration {
  bot_id: string; // 主キー
  workspace_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null; // ISO 8601
  database_id: string | null;
  parent_page_id: string | null; // ArXiv Papers ページの ID
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

/**
 * OAuth States テーブルのレコード型（将来用）
 */
export interface OAuthStateRecord {
  state: string;
  created_at: string; // ISO 8601
  expires_at: string; // ISO 8601
}

/**
 * Workspace 作成用の入力型
 */
export interface CreateWorkspaceInput {
  id: string;
  workspace_name: string | null;
  workspace_icon: string | null;
}

/**
 * Integration 作成用の入力型
 */
export interface CreateIntegrationInput {
  bot_id: string;
  workspace_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at?: string | null;
  database_id?: string | null;
  parent_page_id?: string | null;
}

/**
 * Integration 更新用の入力型
 */
export interface UpdateIntegrationInput {
  workspace_id?: string;
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string | null;
  database_id?: string | null;
  parent_page_id?: string | null;
}
