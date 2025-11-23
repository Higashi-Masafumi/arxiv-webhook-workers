-- Notion × ArXiv 自動同期システム
-- 初期マイグレーション

-- workspaces テーブル
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,              -- workspace_id
  workspace_name TEXT,
  workspace_icon TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- integrations テーブル
CREATE TABLE integrations (
  bot_id TEXT PRIMARY KEY,          -- Notion が推奨する主キー
  workspace_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at DATETIME,        -- 推定有効期限（安全マージン付き）
  database_id TEXT,                 -- ArXiv データベース ID
  duplicated_template_id TEXT,      -- テンプレート複製時のページ ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- oauth_states テーブル（将来用、現在は KV を使用）
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

-- インデックス
CREATE INDEX idx_integrations_workspace ON integrations(workspace_id);
CREATE INDEX idx_integrations_expires ON integrations(token_expires_at);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);

