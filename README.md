# ArXiv Webhook Workers

Notion と ArXiv を連携し、ArXiv 論文の URL を Notion データベースに入力すると自動的にメタデータ（タイトル、著者、要約、公開年）を取得・更新する Cloudflare Workers アプリケーション。

## 技術スタック

- **実行環境**: Cloudflare Workers
- **Web フレームワーク**: Hono
- **データベース**: Cloudflare D1（トークン・設定管理）
- **KV ストア**: Cloudflare KV（OAuth state 管理）
- **定期実行**: Cron Triggers（トークンリフレッシュ）
- **外部 API**: Notion API, ArXiv API
- **言語**: TypeScript

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install
```

### 2. Notion Integration の作成

1. [Notion Integrations](https://www.notion.so/profile/integrations) にアクセス
2. 「New integration」をクリック
3. Integration タイプで「Public」を選択
4. 必要情報を入力:
   - **Name**: ArXiv Webhook
   - **Redirect URI**: `https://your-worker.workers.dev/notion/oauth/callback`
5. OAuth Client ID と Client Secret を取得

### 3. Cloudflare D1 データベースの作成

```bash
# D1 データベースを作成
pnpm wrangler d1 create arxiv-notion-db

# 出力された database_id を wrangler.jsonc の d1_databases.database_id に設定

# マイグレーションを実行（初期スキーマ）
pnpm wrangler d1 execute arxiv-notion-db --file=./migrations/0001_initial.sql

# マイグレーションを実行（parent_page_id 追加）
pnpm wrangler d1 execute arxiv-notion-db --file=./migrations/0002_add_parent_page_id.sql
```

### 4. Cloudflare KV Namespace の作成

```bash
# KV Namespace を作成
pnpm wrangler kv namespace create KV

# 出力された id を wrangler.jsonc の kv_namespaces.id に設定
```

### 5. 環境変数の設定

```bash
# Notion OAuth Credentials を設定
pnpm wrangler secret put NOTION_CLIENT_ID
# 入力: your-notion-client-id

pnpm wrangler secret put NOTION_CLIENT_SECRET
# 入力: your-notion-client-secret

# Worker URL を wrangler.jsonc の vars.WORKER_URL に設定
# 例: https://arxiv-webhook-workers.your-subdomain.workers.dev
```

### 6. デプロイ

```bash
# 本番環境にデプロイ
pnpm wrangler deploy

# 本番環境の D1 にマイグレーション実行
pnpm wrangler d1 execute arxiv-notion-db --remote --file=./migrations/0001_initial.sql
pnpm wrangler d1 execute arxiv-notion-db --remote --file=./migrations/0002_add_parent_page_id.sql
```

## 使い方

### 1. Notion と連携

1. `https://your-worker.workers.dev/notion/connect` にアクセス
2. Notion の OAuth 画面で連携を承認
3. 自動的に「ArXiv Papers」ページとデータベースが作成されます
4. 連携完了ページが表示される

### 2. Notion Automation の設定

1. Notion で ArXiv Papers データベースを開く
2. 右上の「...」→「Automations」→「New automation」
3. トリガー: 「When a page is updated」
4. アクション: 「Send HTTP request」
5. 設定:
   - **URL**: `https://your-worker.workers.dev/notion/webhook`
   - **Method**: `POST`
   - **Body**:
     ```json
     {
       "workspace_id": "your-workspace-id",
       "page_id": "{{page_id}}",
       "link": "{{Link}}"
     }
     ```

### 3. 論文情報の自動取得

1. データベースに新しいページを作成
2. Link プロパティに ArXiv URL を入力（例: `https://arxiv.org/abs/2301.12345`）
3. 数秒後、自動的にタイトル・著者・要約が入力されます

## 開発

### ローカル開発サーバーの起動

```bash
pnpm dev
```

### 型生成

```bash
pnpm cf-typegen
```

### D1 データベースの操作

```bash
# ローカルで SQL を実行
pnpm wrangler d1 execute arxiv-notion-db --command="SELECT * FROM integrations"

# 本番環境で SQL を実行
pnpm wrangler d1 execute arxiv-notion-db --remote --command="SELECT * FROM integrations"
```

## アーキテクチャ

詳細は [docs/architecture.md](./docs/architecture.md) を参照してください。

- **Routes Layer**: HTTP エンドポイント
- **Services Layer**: ビジネスロジック
- **Libs Layer**: 外部 API クライアント
- **Middleware**: エラーハンドリング、ロギング

## 機能

- ✅ Notion OAuth 2.0 認証
- ✅ ArXiv ワークスペース自動セットアップ（ページ + データベース自動作成）
- ✅ ArXiv 論文メタデータ自動取得
- ✅ Notion ページ自動更新
- ✅ トークン自動リフレッシュ（Cron Triggers）
- ✅ D1 による永続化
- ✅ エラーハンドリング

## ライセンス

MIT

## ドキュメント

- [要件定義書](./docs/requirements.md)
- [アーキテクチャ設計書](./docs/architecture.md)
- [シーケンス図](./docs/sequences.md)
- [型定義仕様](./docs/types.md)
