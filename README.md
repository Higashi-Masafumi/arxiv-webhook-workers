# ArXiv Webhook Workers

Notion と論文サイトを連携し、論文の URL を Notion データベースに入力すると自動的にメタデータ（タイトル、著者、要約、公開年）を取得・更新する Cloudflare Workers アプリケーション。

ArXiv に加えて **IEEE Xplore・ACM DL・Springer・Nature・Wiley・ScienceDirect などの DOI ベースの論文サイト**にも対応しています。対応範囲と取得の仕組みは [対応している論文サイト](#対応している論文サイト) を参照してください。

## 技術スタック

- **実行環境**: Cloudflare Workers
- **Web フレームワーク**: Hono
- **データベース**: Cloudflare D1（トークン・設定管理）
- **KV ストア**: Cloudflare KV（OAuth state 管理）
- **定期実行**: Cron Triggers（トークンリフレッシュ）
- **外部 API**: Notion API, OpenAlex API, Crossref API
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

# （任意）Crossref / OpenAlex の polite pool 用連絡先メールアドレス
# 設定するとレート制限が緩和されます（wrangler.jsonc の vars でも可）
pnpm wrangler secret put CONTACT_EMAIL
```

#### 環境変数一覧

| 変数 | 必須 | 説明 |
| --- | --- | --- |
| `NOTION_CLIENT_ID` | ✅ | Notion OAuth Client ID |
| `NOTION_CLIENT_SECRET` | ✅ | Notion OAuth Client Secret |
| `WORKER_URL` | ✅ | デプロイ先の Worker URL |
| `CONTACT_EMAIL` | – | Crossref / OpenAlex の polite pool 用連絡先 |

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

1. Notion で ArXiv Papers Database を開く
2. 右上の「...」→「Automations」→「New automation」
3. トリガー: 「When a page is updated」
4. アクション: 「Send HTTP request」
5. 設定:
   - **URL**: `https://your-worker.workers.dev/notion/webhook`
   - **Method**: `POST`
   - **Body**: `{{page}}`（これだけで OK！）

### 3. 論文情報の自動取得

1. データベースに新しいページを作成
2. Link プロパティに論文の URL を入力（例: `https://arxiv.org/abs/2301.12345`、`https://ieeexplore.ieee.org/document/9156697`）
3. 数秒後、自動的にタイトル・著者・要約が入力されます

## 対応している論文サイト

どの論文 URL も **DOI に変換してから書誌 API で引く**という一本道で処理します。
サイトごとの取得ロジックは持ちません。

```
URL --(文字列だけで決まるか)--> DOI --> OpenAlex（無ければ Crossref）--> メタデータ
     \--(決まらなければページを1回見て DOI を探す)--/
```

| URL の例 | DOI の求め方 |
| --- | --- |
| `doi.org/10.1145/...`<br>`dl.acm.org/doi/10.1145/...`<br>`link.springer.com/article/10.1007/...`<br>`onlinelibrary.wiley.com/doi/10.1002/...` | URL に DOI がそのまま入っている |
| `arxiv.org/abs/2301.12345`<br>`arxiv.org/pdf/2301.12345v2`<br>`arxiv.org/abs/cs/0112017`（旧形式） | arXiv ID から DataCite DOI を組み立てる<br>(`10.48550/arXiv.2301.12345`) |
| `nature.com/articles/s41586-...` | 記事 slug が DOI 接尾辞と一致する |
| 上記以外（IEEE Xplore / ScienceDirect / MDPI / ACL Anthology / bioRxiv など） | ページを 1 回取得して `citation_doi` などから DOI を探す |

### 設計上の注意

- **サイトごとの取得ロジックは持ちません。** 出版社ごとにタイトル・著者・
  アブストラクトをスクレイピングすると、出版社の数だけパーサーが増えて壊れやすく
  なります。DOI さえ分かればあとは書誌 API の仕事なので、ページから読み取るのは
  **DOI 1 つだけ**に限定しています（`libs/doiFromPage.ts`）。
- **arXiv 公式 API (export.arxiv.org) は使っていません。** クラウド事業者の IP からの
  自動アクセスをまとめて遮断することがあり、その間 403 が返り続けてリトライでも
  回復しないためです。arXiv 論文には投稿時に DataCite DOI
  (`10.48550/arXiv.xxxx`) が振られるので、それをキーに OpenAlex から引いています。
  OpenAlex は API キー不要・CC0 で、arXiv 以外の出版社もほぼ全て同じ経路でカバーできます。
- **IEEE Xplore は bot 対策があります。** DOI が URL に含まれないためページを
  取得しますが、Cloudflare Workers の IP からは 403 が返ることがあります。
  その場合は IEEE の URL ではなく DOI の URL
  （`https://doi.org/10.1109/...`）を Link プロパティに入れてください。
- **アブストラクトが取れないことがあります。** OpenAlex にも Crossref にも
  アブストラクトが無い論文では、要約欄が空のまま更新されます。
- **ペイウォールの内側は取得しません。** 取得対象は各サイトが公開している
  書誌メタデータのみです。

## 開発

### ローカル開発サーバーの起動

```bash
pnpm dev
```

### 型生成

```bash
pnpm cf-typegen
```

### テスト・型チェック

```bash
# パーサー・URL 判定のユニットテスト
pnpm test

# 型チェック
pnpm typecheck
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
- ✅ ワークスペース自動セットアップ（ページ + データベース自動作成）
- ✅ 論文 URL の DOI 解決（arXiv / DOI ベースの論文サイト / ページからの DOI 抽出）
- ✅ DOI からのメタデータ取得（OpenAlex → Crossref）
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
