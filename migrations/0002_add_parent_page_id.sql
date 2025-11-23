-- Notion × ArXiv 自動同期システム
-- マイグレーション: parent_page_id カラム追加、duplicated_template_id 削除

-- 1. parent_page_id カラムを追加
ALTER TABLE integrations ADD COLUMN parent_page_id TEXT;

-- 2. duplicated_template_id カラムを削除（SQLite では直接削除できないため、テーブル再作成）
-- 既存データを保持しながらテーブル構造を変更

-- 2-1. 新しいテーブル構造を作成
CREATE TABLE integrations_new (
  bot_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at DATETIME,
  database_id TEXT,
  parent_page_id TEXT,              -- 新規追加: ArXiv Papers ページの ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- 2-2. 既存データをコピー（duplicated_template_id を除外）
INSERT INTO integrations_new (
  bot_id,
  workspace_id,
  access_token,
  refresh_token,
  token_expires_at,
  database_id,
  parent_page_id,
  created_at,
  updated_at
)
SELECT
  bot_id,
  workspace_id,
  access_token,
  refresh_token,
  token_expires_at,
  database_id,
  NULL,  -- parent_page_id は NULL で初期化
  created_at,
  updated_at
FROM integrations;

-- 2-3. 古いテーブルを削除
DROP TABLE integrations;

-- 2-4. 新しいテーブルをリネーム
ALTER TABLE integrations_new RENAME TO integrations;

-- 2-5. インデックスを再作成
CREATE INDEX idx_integrations_workspace ON integrations(workspace_id);
CREATE INDEX idx_integrations_expires ON integrations(token_expires_at);

