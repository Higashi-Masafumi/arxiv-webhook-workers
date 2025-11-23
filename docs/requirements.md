# Notion × ArXiv 自動同期システム 要件定義書

## ドキュメント情報

- **バージョン**: 2.0.0
- **最終更新日**: 2025-11-23
- **対象システム**: ArXiv Webhook Workers
- **実行環境**: Cloudflare Workers
- **主な変更**: D1 データベース導入、Notion テンプレート OAuth 対応、トークンリフレッシュ機能追加

---

## 1. システム概要

### 1.1 目的

本システムは、ユーザーの Notion ワークスペースと OAuth 2.0 を利用して連携し、ArXiv API から取得した論文情報を Notion データベースに自動的に反映する SaaS アプリケーションである。

研究者や学生が ArXiv の論文情報を Notion で一元管理し、論文の URL を登録するだけで自動的にメタデータ（タイトル、著者、要約、公開年）を取得・更新できる仕組みを提供する。

### 1.2 システムの特徴

- **OAuth 2.0 による安全な認証**: Notion の公式 OAuth フローとテンプレート機能を使用
- **テンプレート自動複製**: ユーザーが OAuth 時にテンプレートを複製し、即座に利用開始
- **トークン自動リフレッシュ**: Cron Triggers による定期的なアクセストークン更新
- **リアルタイム同期**: Notion Automations を通じた準リアルタイム更新
- **サーバーレスアーキテクチャ**: Cloudflare Workers + D1 による高速・低コスト運用

---

## 2. 技術スタック

| カテゴリ                   | 技術               | バージョン | 用途                               |
| -------------------------- | ------------------ | ---------- | ---------------------------------- |
| **実行環境**               | Cloudflare Workers | -          | サーバーレス実行基盤               |
| **Web フレームワーク**     | Hono               | ^4.10.6    | HTTP ルーティング・ミドルウェア    |
| **Notion クライアント**    | @notionhq/client   | ^5.4.0     | Notion API 操作                    |
| **データベース**           | Cloudflare D1      | -          | トークン・設定の永続化（SQL）      |
| **KV ストア**              | Cloudflare KV      | -          | OAuth state 一時保存               |
| **定期実行**               | Cron Triggers      | -          | トークンリフレッシュ（6 時間ごと） |
| **外部 API**               | ArXiv API          | -          | 論文メタデータ取得                 |
| **言語**                   | TypeScript         | ESNext     | 型安全な開発                       |
| **パッケージマネージャー** | pnpm               | -          | 依存関係管理                       |

### 2.1 技術選定理由

- **Cloudflare Workers**: グローバルエッジネットワークによる低レイテンシ、従量課金による低コスト
- **Hono**: 軽量かつ高速、Workers に最適化された Web フレームワーク
- **@notionhq/client**: Notion 公式 SDK による安定した API アクセス
- **Cloudflare D1**: Workers と統合された SQL データベース、トランザクション対応、トークン管理に最適
- **Cloudflare KV**: TTL 機能による一時データ保存に最適（OAuth state）
- **Cron Triggers**: Workers 内で定期実行可能、外部サービス不要

---

## 3. 機能要件

### 3.1 Notion OAuth 連携機能

#### 3.1.1 認証フロー開始

**エンドポイント**: `GET /notion/connect`

**クエリパラメータ**: なし

**処理内容**:

1. ランダムな `state` 値を生成（CSRF 対策）
2. `state` を KV に保存（TTL: 10 分）
   - Key: `state:{state}`
   - Value: `{ createdAt: timestamp }`
3. Notion OAuth 認可 URL にリダイレクト
   - `client_id`: 環境変数 `NOTION_CLIENT_ID`
   - `redirect_uri`: `{WORKER_URL}/notion/oauth/callback`
   - `response_type`: `code`
   - `owner`: `user`
   - `state`: 生成した state 値

**OAuth URL 例**:

```
https://api.notion.com/v1/oauth/authorize?
  client_id=xxx&
  redirect_uri=https://your-worker.workers.dev/notion/oauth/callback&
  response_type=code&
  owner=user&
  state=yyy
```

**レスポンス**:

- 302 Redirect to Notion OAuth page

**エラーケース**:

- KV 保存失敗: 500 Internal Server Error

**Notion OAuth 画面での動作**:

ユーザーは以下のいずれかを選択：

1. **「Duplicate template」**: 事前設定されたテンプレートを複製（推奨）
2. **「Select pages」**: 既存のページを選択してアクセス許可

#### 3.1.2 OAuth コールバック処理

**エンドポイント**: `GET /notion/oauth/callback`

**クエリパラメータ**:

- `code` (必須): Notion から返される認可コード
- `state` (必須): CSRF 検証用の state 値

**処理内容**:

1. `state` を検証（KV から取得して照合）
2. `code` を使用してアクセストークンを取得
   - POST `https://api.notion.com/v1/oauth/token`
   - Basic 認証: `Base64(NOTION_CLIENT_ID:NOTION_CLIENT_SECRET)`
   - Body: `{ grant_type: "authorization_code", code, redirect_uri }`
3. Notion からのレスポンス:
   ```json
   {
     "access_token": "secret_xxx",
     "refresh_token": "nrt_xxx",
     "bot_id": "xxx",
     "workspace_id": "xxx",
     "workspace_name": "My Workspace",
     "workspace_icon": "https://...",
     "duplicated_template_id": "page-id-xxx" // テンプレート使用時のみ
   }
   ```
4. D1 にワークスペース情報を保存
   - `workspaces` テーブルに workspace 情報を INSERT/UPDATE
5. `duplicated_template_id` が存在する場合:
   - `search` API で複製されたテンプレート配下のデータベースを検索
   - "ArXiv Papers" という名前のデータベースを特定
6. `duplicated_template_id` が null の場合:
   - `search` API で全データベースを検索
   - "ArXiv Papers" データベースがあればそれを使用
   - なければ、アクセス可能な最初のページ配下に新規作成
7. D1 の `integrations` テーブルに保存:
   - `bot_id` (主キー)
   - `workspace_id`
   - `access_token`
   - `refresh_token`
   - `token_expires_at` (現在時刻 + 7 日間の推定値)
   - `database_id`
   - `duplicated_template_id`
8. KV から使用済み state を削除
9. 成功ページを返す（DB URL と Webhook URL を表示）

**レスポンス**:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Notion 連携完了</title>
  </head>
  <body>
    <h1>✅ 連携が完了しました</h1>
    <p>
      データベース:
      <a href="https://notion.so/{database_id}" target="_blank">ArXiv Papers</a>
    </p>
    <h2>次のステップ</h2>
    <p>
      Notion Automation を設定して、論文 URL
      を入力すると自動的にメタデータが取得されるようにします。
    </p>
    <ol>
      <li>Notion で上記データベースを開く</li>
      <li>右上の「...」→「Automations」→「New automation」</li>
      <li>トリガー: 「When a page is updated」</li>
      <li>アクション: 「Send HTTP request」</li>
      <li>URL: <code>{WORKER_URL}/notion/webhook</code></li>
      <li>Method: <code>POST</code></li>
      <li>
        Body: JSON形式で以下を設定<br />
        <code>
          {<br />
          &nbsp;&nbsp;"workspace_id": "{workspace_id}",<br />
          &nbsp;&nbsp;"page_id": "{{page_id}}",<br />
          &nbsp;&nbsp;"link": "{{Link}}"<br />
          }
        </code>
      </li>
    </ol>
    <h2>使い方</h2>
    <ol>
      <li>データベースに新しいページを作成</li>
      <li>
        Link プロパティに ArXiv URL を入力（例:
        https://arxiv.org/abs/2301.12345）
      </li>
      <li>数秒後、自動的にタイトル・著者・要約が入力されます</li>
    </ol>
  </body>
</html>
```

**エラーケース**:

- `state` 不一致: 403 Forbidden
- `code` が無効: 401 Unauthorized
- トークン取得失敗: 401 Unauthorized
- データベース検索失敗: 500 Internal Server Error
- D1 保存失敗: 500 Internal Server Error

### 3.2 ArXiv データベース特定・作成機能

#### 3.2.1 データベーススキーマ

**データベース名**: `ArXiv Papers`

**プロパティ定義**:

| Property 名        | Notion Type | 説明                   | 必須 |
| ------------------ | ----------- | ---------------------- | ---- |
| `Title`            | `title`     | 論文タイトル           | ✓    |
| `Authors`          | `rich_text` | 著者名（カンマ区切り） | ✓    |
| `Summary`          | `rich_text` | 論文要約               | ✓    |
| `Link`             | `url`       | ArXiv 論文 URL         | ✓    |
| `Publication Year` | `number`    | 公開年（4 桁整数）     | ✓    |

#### 3.2.2 テンプレートからのデータベース検索

**前提**: Integration 設定で「Notion URL for optional template」にテンプレートページ URL を設定済み

**使用 API**: `notion.search()`

**処理フロー**:

1. OAuth コールバックで `duplicated_template_id` を取得
2. `search` API を呼び出し:
   ```typescript
   {
     filter: {
       value: "database",
       property: "object"
     },
     sort: {
       direction: "descending",
       timestamp: "last_edited_time"
     }
   }
   ```
3. 結果から "ArXiv Papers" という名前のデータベースを検索
4. 見つかった場合、その `database_id` を使用
5. 見つからない場合、`duplicated_template_id` を parent として新規作成

#### 3.2.3 データベース新規作成（代替フロー）

**使用 API**: `notion.databases.create()`

**リクエスト構造**:

```typescript
{
  parent: {
    type: "page_id",
    page_id: parentPageId  // duplicated_template_id または最初のアクセス可能ページ
  },
  title: [
    {
      type: "text",
      text: { content: "ArXiv Papers" }
    }
  ],
  properties: {
    Title: {
      title: {}
    },
    Authors: {
      rich_text: {}
    },
    Summary: {
      rich_text: {}
    },
    Link: {
      url: {}
    },
    "Publication Year": {
      number: {
        format: "number"
      }
    }
  }
}
```

**エラーハンドリング**:

- 親ページが存在しない: 404 エラー
- アクセス権限がない: 403 エラー
- API レート制限: 429 エラー（リトライ処理）
- データベースが見つからず、作成も失敗: 500 エラー

### 3.3 Webhook 受信機能

#### 3.3.1 Webhook エンドポイント

**エンドポイント**: `POST /notion/webhook`

**リクエストボディ**:

```json
{
  "workspace_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "page_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "link": "https://arxiv.org/abs/2301.12345"
}
```

**処理フロー**:

1. リクエストボディを検証
   - `workspace_id`, `page_id`, `link` の存在確認
   - `link` が ArXiv URL 形式か検証（正規表現）
2. D1 から `workspace_id` に対応する integration 情報を取得
   - SQL: `SELECT * FROM integrations WHERE workspace_id = ?`
3. Integration が存在しない場合は 404 エラー
4. `access_token` の有効期限をチェック
   - `token_expires_at` が現在時刻より前の場合、リフレッシュ（3.7 参照）
5. `link` から ArXiv ID を抽出（3.4 参照）
6. ArXiv API から論文情報を取得（3.5 参照）
7. Notion ページを更新（3.6 参照）
8. 成功レスポンスを返す

**レスポンス**:

```json
{
  "success": true,
  "page_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "updated_at": "2025-11-22T12:34:56.789Z"
}
```

**エラーケース**:

- リクエストボディが不正: 400 Bad Request
- Integration が見つからない: 404 Not Found
- トークンリフレッシュ失敗: 401 Unauthorized
- ArXiv ID が抽出できない: 400 Bad Request
- ArXiv API エラー: 502 Bad Gateway
- Notion API エラー: 500 Internal Server Error
- D1 クエリエラー: 500 Internal Server Error

#### 3.3.2 ArXiv URL パターン

対応する URL 形式:

- `https://arxiv.org/abs/2301.12345`
- `https://arxiv.org/abs/2301.12345v1`
- `https://arxiv.org/pdf/2301.12345.pdf`
- `http://arxiv.org/abs/2301.12345`

正規表現:

```typescript
const ARXIV_URL_PATTERN =
  /arxiv\.org\/(abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?(\.pdf)?/;
```

### 3.4 ArXiv ID 抽出機能

**入力**: ArXiv URL 文字列

**出力**: ArXiv ID（例: `2301.12345`）

**処理**:

1. URL から正規表現で ID 部分を抽出
2. バージョン番号（v1, v2 など）は除去
3. 拡張子（.pdf）は除去

**実装例**:

```typescript
function extractArxivId(url: string): string | null {
  const match = url.match(/arxiv\.org\/(abs|pdf)\/(\d{4}\.\d{4,5})/);
  return match ? match[2] : null;
}
```

### 3.5 ArXiv API 連携機能

#### 3.5.1 API 仕様

**エンドポイント**: `http://export.arxiv.org/api/query`

**クエリパラメータ**:

- `id_list`: ArXiv ID（例: `2301.12345`）
- `max_results`: 1

**リクエスト例**:

```
GET http://export.arxiv.org/api/query?id_list=2301.12345&max_results=1
```

**レスポンス形式**: Atom XML

**取得するフィールド**:

- `<title>`: 論文タイトル
- `<author><name>`: 著者名（複数）
- `<summary>`: 論文要約
- `<id>`: 論文 URL
- `<published>`: 公開日（YYYY-MM-DD 形式）

#### 3.5.2 XML パース処理

**処理内容**:

1. Atom XML をパース
2. 必要なフィールドを抽出
3. TypeScript オブジェクトに変換

**データ構造**:

```typescript
interface ArxivPaper {
  title: string;
  authors: string[];
  summary: string;
  link: string;
  publishedYear: number;
}
```

**実装上の注意**:

- タイトルと要約の改行・空白を正規化
- 著者が複数の場合はカンマ区切りで結合
- 公開日から年のみを抽出

#### 3.5.3 エラーハンドリング

- API が 404 を返す: 論文が見つからない
- API が 503 を返す: サービス一時停止（リトライ）
- XML パースエラー: 不正なレスポンス
- タイムアウト: 10 秒でタイムアウト

### 3.6 Notion ページ更新機能

#### 3.6.1 更新処理

**使用 API**: `notion.pages.update()`

**リクエスト構造**:

```typescript
{
  page_id: pageId,
  properties: {
    Title: {
      title: [
        {
          type: "text",
          text: { content: paper.title }
        }
      ]
    },
    Authors: {
      rich_text: [
        {
          type: "text",
          text: { content: paper.authors.join(", ") }
        }
      ]
    },
    Summary: {
      rich_text: [
        {
          type: "text",
          text: { content: paper.summary }
        }
      ]
    },
    Link: {
      url: paper.link
    },
    "Publication Year": {
      number: paper.publishedYear
    }
  }
}
```

#### 3.6.2 文字数制限対応

Notion API の制限:

- `title`: 2000 文字
- `rich_text`: 2000 文字（1 ブロックあたり）

**対応策**:

- タイトルが 2000 文字を超える場合は切り詰める
- 要約が 2000 文字を超える場合は複数の `rich_text` ブロックに分割

**実装例**:

```typescript
function splitRichText(text: string, maxLength: number = 2000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push({
      type: "text",
      text: { content: text.slice(i, i + maxLength) },
    });
  }
  return chunks;
}
```

### 3.7 トークンリフレッシュ機能

#### 3.7.1 概要

Notion の `access_token` は有効期限があるため、定期的にリフレッシュする必要がある。
Cloudflare Cron Triggers を使用して、6 時間ごとに有効期限が近いトークンを自動リフレッシュする。

#### 3.7.2 Cron Triggers 設定

**実行頻度**: 6 時間ごと（`0 */6 * * *`）

**処理内容**:

1. D1 から有効期限が 24 時間以内のトークンを取得
   ```sql
   SELECT * FROM integrations
   WHERE token_expires_at < datetime('now', '+24 hours')
   OR token_expires_at IS NULL
   ```
2. 各トークンに対してリフレッシュ処理を実行
3. エラーが発生した場合はログに記録し、次回リトライ

#### 3.7.3 トークンリフレッシュ API

**エンドポイント**: `POST https://api.notion.com/v1/oauth/token`

**認証**: Basic 認証（`Base64(CLIENT_ID:CLIENT_SECRET)`）

**リクエストボディ**:

```json
{
  "grant_type": "refresh_token",
  "refresh_token": "nrt_xxx"
}
```

**レスポンス**:

```json
{
  "access_token": "secret_new_xxx",
  "refresh_token": "nrt_new_xxx",
  "bot_id": "xxx",
  "workspace_id": "xxx",
  "workspace_name": "My Workspace"
}
```

**注意**: リフレッシュすると、**新しい `access_token` と新しい `refresh_token` の両方**が発行される。

#### 3.7.4 D1 更新処理

リフレッシュ成功後、D1 の `integrations` テーブルを更新:

```sql
UPDATE integrations
SET
  access_token = ?,
  refresh_token = ?,
  token_expires_at = datetime('now', '+7 days'),
  updated_at = CURRENT_TIMESTAMP
WHERE bot_id = ?
```

**有効期限の推定**:

- Notion は明示的な有効期限を返さないため、安全マージンとして 7 日間を設定
- 実際の有効期限はより長い可能性があるが、頻繁にリフレッシュしても問題ない

#### 3.7.5 手動リフレッシュエンドポイント（オプション）

**エンドポイント**: `POST /notion/refresh-token`

**リクエストボディ**:

```json
{
  "workspace_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
}
```

**処理内容**:

1. D1 から `workspace_id` に対応する integration を取得
2. トークンリフレッシュを実行
3. D1 を更新

**用途**:

- トークンが期限切れになった場合の緊急対応
- テスト・デバッグ用

#### 3.7.6 エラーハンドリング

**リフレッシュ失敗時の対応**:

1. **401 Unauthorized**: `refresh_token` が無効

   - ログに記録
   - ユーザーに再認証を促す通知（将来実装）
   - D1 のレコードは保持（再認証時に更新）

2. **429 Rate Limit**: レート制限

   - 指数バックオフでリトライ（1 秒、2 秒、4 秒）
   - 最大 3 回リトライ

3. **503 Service Unavailable**: Notion API 一時停止

   - 次回の Cron 実行時に再試行

4. **その他のエラー**:
   - ログに記録
   - 次回の Cron 実行時に再試行

---

## 4. 非機能要件

### 4.1 性能要件

| 項目                 | 要件                 | 測定方法                 |
| -------------------- | -------------------- | ------------------------ |
| API レスポンスタイム | 95%ile で 500ms 以内 | Cloudflare Analytics     |
| Webhook 処理時間     | 平均 2 秒以内        | ログ分析                 |
| 同時接続数           | 1000 req/s           | Workers の制限内         |
| KV 読み取り          | 10ms 以内            | Cloudflare KV メトリクス |

### 4.2 可用性要件

| 項目           | 要件                                            |
| -------------- | ----------------------------------------------- |
| システム稼働率 | 99.9% 以上（Cloudflare SLA に準拠）             |
| データ永続性   | KV の耐久性保証に準拠                           |
| リージョン     | グローバル分散（Cloudflare エッジネットワーク） |

### 4.3 セキュリティ要件

#### 4.3.1 認証・認可

- Notion OAuth 2.0 による安全な認証
- `state` パラメータによる CSRF 対策
- アクセストークンは KV に暗号化せず保存（Workers 環境の信頼性に依存）
- トークンの有効期限管理（Notion 側で管理）

#### 4.3.2 データ保護

- HTTPS 通信の強制
- 環境変数による機密情報管理（`NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`）
- KV データへのアクセス制限（Workers からのみアクセス可能）

#### 4.3.3 入力検証

- すべてのユーザー入力を検証
- ArXiv URL の正規表現検証
- Notion API レスポンスの型検証

### 4.4 拡張性要件

#### 4.4.1 現在の制約

- 1 ワークスペースにつき 1 つの ArXiv データベースのみ管理
- Notion Automations による手動設定が必要

#### 4.4.2 将来の拡張可能性

- 複数データベース管理への対応
- Notion Webhooks API（Public Beta）への移行
- バッチ同期機能の追加
- 論文検索機能の追加

### 4.5 保守性要件

- TypeScript による型安全なコード
- モジュール分割による責務の明確化
- エラーログの適切な出力
- ドキュメントの整備

---

## 5. データモデル

### 5.1 Cloudflare D1 設計

#### 5.1.1 テーブル構造

**workspaces テーブル**:

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,              -- workspace_id
  workspace_name TEXT,
  workspace_icon TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**integrations テーブル**:

```sql
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
```

**oauth_states テーブル**:

```sql
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);
```

#### 5.1.2 インデックス

```sql
CREATE INDEX idx_integrations_workspace ON integrations(workspace_id);
CREATE INDEX idx_integrations_expires ON integrations(token_expires_at);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);
```

#### 5.1.3 TypeScript 型定義

```typescript
interface Workspace {
  id: string; // workspace_id
  workspace_name: string | null;
  workspace_icon: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

interface Integration {
  bot_id: string; // 主キー
  workspace_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string | null; // ISO 8601
  database_id: string | null;
  duplicated_template_id: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

interface OAuthStateRecord {
  state: string;
  created_at: string; // ISO 8601
  expires_at: string; // ISO 8601
}
```

#### 5.1.4 マイグレーション

**初期マイグレーション** (`migrations/0001_initial.sql`):

```sql
-- workspaces テーブル
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  workspace_name TEXT,
  workspace_icon TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- integrations テーブル
CREATE TABLE integrations (
  bot_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at DATETIME,
  database_id TEXT,
  duplicated_template_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- oauth_states テーブル
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL
);

-- インデックス
CREATE INDEX idx_integrations_workspace ON integrations(workspace_id);
CREATE INDEX idx_integrations_expires ON integrations(token_expires_at);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);
```

### 5.2 Cloudflare KV 設計（簡素化）

#### 5.2.1 キー命名規則

| Key パターン    | 説明                 | TTL    | 例                |
| --------------- | -------------------- | ------ | ----------------- |
| `state:{state}` | OAuth state 一時保存 | 600 秒 | `state:abc123xyz` |

#### 5.2.2 データ構造

**OAuth State データ**:

```typescript
interface OAuthState {
  createdAt: number; // Unix timestamp (ms)
}
```

**注**: KV は OAuth state の一時保存のみに使用。TTL 機能により自動削除される。

### 5.3 データライフサイクル

1. **OAuth State (KV)**: 認可フロー開始時に作成、10 分後に自動削除
2. **Workspace (D1)**: OAuth 完了時に作成、永続化
3. **Integration (D1)**: OAuth 完了時に作成、トークンリフレッシュ時に更新
4. **OAuth States (D1)**: 将来的に KV から移行する可能性あり（現時点では KV を使用）

---

## 6. API エンドポイント仕様

### 6.1 エンドポイント一覧

| メソッド | パス                     | 説明                       | 認証 |
| -------- | ------------------------ | -------------------------- | ---- |
| GET      | `/`                      | ヘルスチェック             | 不要 |
| GET      | `/notion/connect`        | OAuth 認可開始             | 不要 |
| GET      | `/notion/oauth/callback` | OAuth コールバック         | 不要 |
| POST     | `/notion/webhook`        | Webhook 受信               | 不要 |
| POST     | `/notion/refresh-token`  | 手動トークンリフレッシュ   | 不要 |
| GET      | `/cron/refresh-tokens`   | Cron: トークンリフレッシュ | Cron |

**注**: `/cron/refresh-tokens` は Cron Triggers から自動実行されるため、外部からのアクセスは不要。

### 6.2 共通レスポンスヘッダー

```
Content-Type: application/json
X-Powered-By: Cloudflare Workers
```

### 6.3 共通エラーレスポンス

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "エラーメッセージ",
    "details": {} // オプション
  }
}
```

**エラーコード一覧**:

| コード                | HTTP Status | 説明                   |
| --------------------- | ----------- | ---------------------- |
| `INVALID_REQUEST`     | 400         | リクエストが不正       |
| `UNAUTHORIZED`        | 401         | 認証エラー             |
| `FORBIDDEN`           | 403         | アクセス権限なし       |
| `NOT_FOUND`           | 404         | リソースが見つからない |
| `RATE_LIMIT_EXCEEDED` | 429         | レート制限超過         |
| `INTERNAL_ERROR`      | 500         | 内部エラー             |
| `BAD_GATEWAY`         | 502         | 外部 API エラー        |
| `SERVICE_UNAVAILABLE` | 503         | サービス一時停止       |

---

## 7. エラーハンドリング要件

### 7.1 エラーログ出力

すべてのエラーは以下の形式でログ出力する:

```typescript
{
  timestamp: "2025-11-22T12:34:56.789Z",
  level: "error",
  message: "エラーメッセージ",
  context: {
    endpoint: "/notion/webhook",
    workspaceId: "xxxx",
    error: {
      name: "NotionAPIError",
      message: "...",
      stack: "..."
    }
  }
}
```

### 7.2 リトライ戦略

**対象**:

- ArXiv API の 503 エラー
- Notion API の 429 エラー（レート制限）

**リトライ設定**:

- 最大リトライ回数: 3 回
- バックオフ: 指数バックオフ（1 秒、2 秒、4 秒）
- タイムアウト: 各リクエスト 10 秒

### 7.3 ユーザーへのエラー通知

- OAuth フロー中のエラー: HTML エラーページを表示
- Webhook エラー: JSON エラーレスポンスを返す
- 重大なエラー: Cloudflare Workers のエラーログに記録

---

## 8. 環境変数

### 8.1 必須環境変数

| 変数名                 | 説明                       | 例                                     |
| ---------------------- | -------------------------- | -------------------------------------- |
| `NOTION_CLIENT_ID`     | Notion OAuth Client ID     | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `NOTION_CLIENT_SECRET` | Notion OAuth Client Secret | `secret_xxxxxxxxxxxxxxxxxxxx`          |
| `WORKER_URL`           | Workers のデプロイ URL     | `https://arxiv-webhook.workers.dev`    |

### 8.2 オプション環境変数

| 変数名               | 説明                          | デフォルト値 |
| -------------------- | ----------------------------- | ------------ |
| `LOG_LEVEL`          | ログレベル                    | `info`       |
| `ARXIV_API_TIMEOUT`  | ArXiv API タイムアウト（ms）  | `10000`      |
| `NOTION_API_TIMEOUT` | Notion API タイムアウト（ms） | `10000`      |

### 8.3 Cloudflare バインディング

`wrangler.jsonc` での設定:

```jsonc
{
  "name": "arxiv-webhook-workers",
  "main": "src/index.ts",
  "compatibility_date": "2025-11-22",

  // Cron Triggers（6時間ごとにトークンリフレッシュ）
  "triggers": {
    "crons": ["0 */6 * * *"]
  },

  // D1 データベース
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "arxiv-notion-db",
      "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    }
  ],

  // KV Namespace（OAuth state のみ）
  "kv_namespaces": [
    {
      "binding": "KV",
      "id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "preview_id": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
  ]
}
```

### 8.4 D1 セットアップ手順

1. **D1 データベース作成**:

   ```bash
   wrangler d1 create arxiv-notion-db
   ```

2. **マイグレーション実行**:

   ```bash
   wrangler d1 execute arxiv-notion-db --file=./migrations/0001_initial.sql
   ```

3. **本番環境にマイグレーション**:

   ```bash
   wrangler d1 execute arxiv-notion-db --remote --file=./migrations/0001_initial.sql
   ```

4. **データベース確認**:
   ```bash
   wrangler d1 execute arxiv-notion-db --command="SELECT name FROM sqlite_master WHERE type='table'"
   ```

---

## 9. 制約事項

### 9.1 Cloudflare Workers の制約

- CPU 時間: 50ms（無料プラン）、30 秒（有料プラン）
- メモリ: 128MB
- リクエストサイズ: 100MB
- レスポンスサイズ: 無制限（ストリーミング）

### 9.2 Cloudflare D1 の制約

| 項目                 | 無料プラン | 有料プラン（Workers Paid） |
| -------------------- | ---------- | -------------------------- |
| データベース数       | 10 個      | 50,000 個                  |
| ストレージ           | 500 MB     | 50 GB                      |
| 1 日あたりの読み取り | 500 万行   | 250 億行                   |
| 1 日あたりの書き込み | 10 万行    | 5000 万行                  |
| クエリサイズ         | 最大 1 MB  | 最大 1 MB                  |
| 行サイズ             | 最大 1 MB  | 最大 1 MB                  |

**本システムでの影響**:

- トークン保存・更新: 1 ワークスペースあたり数回/日
- Webhook 処理: 読み取り 1 回/リクエスト
- Cron リフレッシュ: 読み取り・書き込み各数回/6 時間

無料プランで十分に運用可能。

### 9.3 Notion API の制約

- レート制限: 3 req/s（平均）
- ページプロパティ: 最大 2000 文字
- データベースプロパティ: 最大 100 個
- OAuth トークン: 有効期限あり（明示されていないが、定期リフレッシュを推奨）

### 9.4 ArXiv API の制約

- レート制限: 1 req/3s（推奨）
- 結果数: 最大 30,000 件（本システムでは 1 件のみ取得）

---

## 10. 参考資料

### 10.1 公式ドキュメント

- [Notion API Documentation](https://developers.notion.com/)
- [Notion OAuth Guide](https://developers.notion.com/docs/authorization)
- [Notion Refresh Token API](https://developers.notion.com/reference/refresh-a-token)
- [@notionhq/client SDK](https://github.com/makenotion/notion-sdk-js)
- [ArXiv API Documentation](https://info.arxiv.org/help/api/index.html)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Hono Documentation](https://hono.dev/)

### 10.2 関連ドキュメント

- [architecture.md](./architecture.md) - アーキテクチャ設計書
- [sequences.md](./sequences.md) - シーケンス図
- [types.md](./types.md) - TypeScript 型定義仕様

---

## 11. 変更履歴

| バージョン | 日付       | 変更内容                                                                            | 担当者 |
| ---------- | ---------- | ----------------------------------------------------------------------------------- | ------ |
| 2.0.0      | 2025-11-23 | D1 導入、テンプレート OAuth 対応、トークンリフレッシュ機能追加、parent_page_id 削除 | -      |
| 1.0.0      | 2025-11-22 | 初版作成                                                                            | -      |

---

## 付録 A: Integration 設定手順

### A.1 Notion Integration の作成

1. [Notion Integrations](https://www.notion.so/profile/integrations) にアクセス
2. 「New integration」をクリック
3. Integration タイプで「Public」を選択
4. 必要情報を入力:
   - **Name**: ArXiv Webhook
   - **Associated workspace**: 開発用ワークスペース
   - **Redirect URI**: `https://your-worker.workers.dev/notion/oauth/callback`

### A.2 テンプレートページの作成

1. Notion で新しいページを作成
2. ページ内に ArXiv Papers データベースを作成:
   - **プロパティ**:
     - Title (title)
     - Authors (rich_text)
     - Summary (rich_text)
     - Link (url)
     - Publication Year (number)
3. ページを「Public」に設定（Share → Publish）
4. ページ URL をコピー

### A.3 Integration にテンプレートを設定

1. Integration 設定の「Basic Information」タブを開く
2. 「Notion URL for optional template」にテンプレートページ URL を貼り付け
3. 保存

### A.4 OAuth Credentials の取得

1. Integration 設定の「Configuration」タブを開く
2. 以下をコピー:
   - **OAuth client ID**
   - **OAuth client secret**
   - **Authorization URL**
3. これらを `wrangler.jsonc` の環境変数に設定

## 付録 B: Notion Automation 設定手順

### B.1 Automation の作成

1. Notion で ArXiv Papers データベースを開く
2. 右上の「...」→「Automations」をクリック
3. 「New automation」をクリック

### B.2 トリガーの設定

1. トリガー: 「When a page is updated」を選択
2. 条件: 「Link」プロパティが変更されたとき（オプション）

### B.3 アクションの設定

1. アクション: 「Send HTTP request」を選択
2. 設定:
   - **URL**: `https://your-worker.workers.dev/notion/webhook`
   - **Method**: `POST`
   - **Headers**: `Content-Type: application/json`
   - **Body**:
     ```json
     {
       "workspace_id": "your-workspace-id",
       "page_id": "{{page_id}}",
       "link": "{{Link}}"
     }
     ```

**注**: `workspace_id` は OAuth 完了時に表示される値を使用

### B.4 動作確認

1. データベースに新しいページを作成
2. Link プロパティに ArXiv URL を入力（例: `https://arxiv.org/abs/2301.12345`）
3. 数秒後、他のプロパティが自動的に更新されることを確認

---

**このドキュメントは、ArXiv Notion 同期システムの実装における唯一の信頼できる要件定義書である。**
