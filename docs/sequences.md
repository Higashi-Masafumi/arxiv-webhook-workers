# Notion × ArXiv 自動同期システム シーケンス図

## ドキュメント情報

- **バージョン**: 2.0.0
- **最終更新日**: 2025-11-23
- **対象システム**: ArXiv Webhook Workers
- **関連ドキュメント**: [requirements.md](./requirements.md), [architecture.md](./architecture.md)
- **主な変更**: D1 対応、テンプレート OAuth 対応、トークンリフレッシュフロー追加

---

## 目次

1. [データベース ER 図](#1-データベース-er-図)
2. [OAuth 認証フロー（テンプレート対応）](#2-oauth-認証フローテンプレート対応)
3. [OAuth コールバック時のデータベース操作フロー](#3-oauth-コールバック時のデータベース操作フロー)
4. [データベース検索・作成フロー（旧実装参考）](#4-データベース検索作成フロー旧実装参考)
5. [Webhook 受信フロー](#5-webhook-受信フロー)
6. [ArXiv 同期フロー](#6-arxiv-同期フロー)
7. [トークンリフレッシュフロー](#7-トークンリフレッシュフロー)
8. [エラーハンドリングフロー](#8-エラーハンドリングフロー)

---

## 1. データベース ER 図

### 1.1 エンティティ関係図

```mermaid
erDiagram
    workspaces ||--o{ integrations : "has"

    workspaces {
        TEXT id PK "workspace_id (Notion)"
        TEXT workspace_name "ワークスペース名"
        TEXT workspace_icon "ワークスペースアイコンURL"
        DATETIME created_at "作成日時"
        DATETIME updated_at "更新日時"
    }

    integrations {
        TEXT bot_id PK "ボットID (Notion)"
        TEXT workspace_id FK "ワークスペースID"
        TEXT access_token "アクセストークン"
        TEXT refresh_token "リフレッシュトークン"
        DATETIME token_expires_at "トークン有効期限"
        TEXT database_id "ArXivデータベースID"
        TEXT parent_page_id "親ページID"
        DATETIME created_at "作成日時"
        DATETIME updated_at "更新日時"
    }

    oauth_states {
        TEXT state PK "OAuth state値"
        DATETIME created_at "作成日時"
        DATETIME expires_at "有効期限"
    }
```

### 1.2 テーブル詳細

#### workspaces テーブル

| カラム名         | 型       | 制約        | 説明                         |
| ---------------- | -------- | ----------- | ---------------------------- |
| `id`             | TEXT     | PRIMARY KEY | Notion の workspace_id       |
| `workspace_name` | TEXT     | NULL 許可   | ワークスペース名             |
| `workspace_icon` | TEXT     | NULL 許可   | ワークスペースアイコンの URL |
| `created_at`     | DATETIME | DEFAULT NOW | レコード作成日時             |
| `updated_at`     | DATETIME | DEFAULT NOW | レコード更新日時             |

**インデックス**: なし（主キーのみ）

#### integrations テーブル

| カラム名           | 型       | 制約         | 説明                                      |
| ------------------ | -------- | ------------ | ----------------------------------------- |
| `bot_id`           | TEXT     | PRIMARY KEY  | Notion の bot_id（インテグレーション ID） |
| `workspace_id`     | TEXT     | NOT NULL, FK | ワークスペース ID（workspaces.id 参照）   |
| `access_token`     | TEXT     | NOT NULL     | Notion API アクセストークン               |
| `refresh_token`    | TEXT     | NOT NULL     | トークンリフレッシュ用トークン            |
| `token_expires_at` | DATETIME | NULL 許可    | トークンの推定有効期限（7 日後）          |
| `database_id`      | TEXT     | NULL 許可    | ArXiv データベースの ID                   |
| `parent_page_id`   | TEXT     | NULL 許可    | ArXiv Papers ページの ID                  |
| `created_at`       | DATETIME | DEFAULT NOW  | レコード作成日時                          |
| `updated_at`       | DATETIME | DEFAULT NOW  | レコード更新日時                          |

**外部キー制約**:

- `workspace_id` → `workspaces.id` (ON DELETE CASCADE)

**インデックス**:

- `idx_integrations_workspace`: `workspace_id` に対するインデックス
- `idx_integrations_expires`: `token_expires_at` に対するインデックス（トークンリフレッシュ用）

#### oauth_states テーブル

| カラム名     | 型       | 制約        | 説明                   |
| ------------ | -------- | ----------- | ---------------------- |
| `state`      | TEXT     | PRIMARY KEY | OAuth state 値（UUID） |
| `created_at` | DATETIME | DEFAULT NOW | レコード作成日時       |
| `expires_at` | DATETIME | NOT NULL    | state の有効期限       |

**インデックス**:

- `idx_oauth_states_expires`: `expires_at` に対するインデックス（期限切れ削除用）

**注意**: 現在は Cloudflare KV を使用しており、このテーブルは将来用として定義されています。

### 1.3 リレーションシップ

1. **workspaces ↔ integrations**
   - **関係**: 1 対多（1 つのワークスペースに複数のインテグレーションが存在可能）
   - **外部キー**: `integrations.workspace_id` → `workspaces.id`
   - **削除動作**: CASCADE（ワークスペース削除時、関連するインテグレーションも削除）

### 1.4 データフロー

```mermaid
flowchart TD
    A[OAuth コールバック] --> B[workspaces テーブル]
    A --> C[integrations テーブル]

    B --> B1[INSERT/UPDATE<br/>workspace_id, name, icon]
    C --> C1[既存連携チェック<br/>bot_id で検索]

    C1 -->|存在する| C2[UPDATE<br/>トークン、database_id 等]
    C1 -->|存在しない| C3[INSERT<br/>新規レコード作成]

    D[トークンリフレッシュ] --> C
    D --> C4[UPDATE<br/>access_token, refresh_token]

    E[Webhook 受信] --> C
    E --> C5[SELECT<br/>database_id で検索]
```

---

## 2. OAuth 認証フロー（テンプレート対応）

### 1.1 認証開始からコールバックまで

```mermaid
sequenceDiagram
    participant User as ユーザー<br/>(Browser)
    participant Workers as Cloudflare Workers<br/>(Hono App)
    participant KV as Cloudflare KV
    participant D1 as Cloudflare D1
    participant NotionOAuth as Notion OAuth Server
    participant NotionAPI as Notion API

    Note over User,NotionAPI: Phase 1: 認証開始

    User->>Workers: GET /notion/connect
    activate Workers

    Workers->>Workers: state = crypto.randomUUID()
    Workers->>KV: PUT state:{state}<br/>{ createdAt }
    activate KV
    KV-->>Workers: OK (TTL: 600s)
    deactivate KV

    Workers->>Workers: authUrl = buildOAuthUrl(state)
    Workers-->>User: 302 Redirect to authUrl
    deactivate Workers

    Note over User,NotionAPI: Phase 2: ユーザー認証（テンプレート選択）

    User->>NotionOAuth: GET /authorize?client_id=...&state=...
    activate NotionOAuth
    NotionOAuth-->>User: 認証ページ表示<br/>・Duplicate template<br/>・Select pages
    deactivate NotionOAuth

    User->>NotionOAuth: 「Duplicate template」選択 & 承認
    activate NotionOAuth
    NotionOAuth-->>User: 302 Redirect to callback<br/>?code=xxx&state=yyy
    deactivate NotionOAuth

    Note over User,NotionAPI: Phase 3: トークン取得 & D1 保存

    User->>Workers: GET /notion/oauth/callback<br/>?code=xxx&state=yyy
    activate Workers

    Workers->>KV: GET state:{state}
    activate KV
    KV-->>Workers: { createdAt }
    deactivate KV

    Workers->>Workers: state 検証 OK

    Workers->>NotionOAuth: POST /v1/oauth/token<br/>{ grant_type, code, redirect_uri }
    activate NotionOAuth
    NotionOAuth-->>Workers: { access_token, refresh_token,<br/>workspace_id, workspace_name,<br/>bot_id, duplicated_template_id }
    deactivate NotionOAuth

    Workers->>KV: DELETE state:{state}
    activate KV
    KV-->>Workers: OK
    deactivate KV

    Workers->>D1: INSERT INTO workspaces<br/>(id, workspace_name, workspace_icon)
    activate D1
    D1-->>Workers: OK
    deactivate D1

    Note over Workers: 次のフェーズへ続く<br/>(データベース検索)

    deactivate Workers
```

### 1.2 エラーケース

```mermaid
sequenceDiagram
    participant User as ユーザー<br/>(Browser)
    participant Workers as Cloudflare Workers
    participant KV as Cloudflare KV
    participant NotionOAuth as Notion OAuth Server

    Note over User,NotionOAuth: ケース1: state 不一致

    User->>Workers: GET /notion/oauth/callback<br/>?code=xxx&state=invalid
    activate Workers
    Workers->>KV: GET state:invalid
    activate KV
    KV-->>Workers: null
    deactivate KV
    Workers-->>User: 403 Forbidden<br/>{ error: "Invalid state" }
    deactivate Workers

    Note over User,NotionOAuth: ケース2: code が無効

    User->>Workers: GET /notion/oauth/callback<br/>?code=invalid&state=yyy
    activate Workers
    Workers->>KV: GET state:yyy
    activate KV
    KV-->>Workers: { createdAt }
    deactivate KV
    Workers->>NotionOAuth: POST /v1/oauth/token<br/>{ code: invalid, ... }
    activate NotionOAuth
    NotionOAuth-->>Workers: 401 Unauthorized
    deactivate NotionOAuth
    Workers-->>User: 401 Unauthorized<br/>{ error: "Invalid authorization code" }
    deactivate Workers
```

---

## 3. OAuth コールバック時のデータベース操作フロー

### 2.1 既存連携の取得とデータベース再利用

```mermaid
sequenceDiagram
    participant Workers as Cloudflare Workers<br/>(callback.ts)
    participant D1 as Cloudflare D1
    participant NotionAPI as Notion API

    Note over Workers,NotionAPI: 前提: OAuth トークン取得済み<br/>(tokenData 取得済み)

    activate Workers

    Note over Workers,NotionAPI: Phase 1: 既存連携の取得（冪等性確保）

    Workers->>D1: SELECT * FROM integrations<br/>WHERE bot_id = ?
    activate D1
    D1-->>Workers: existingIntegration | null
    deactivate D1

    Note over Workers,NotionAPI: Phase 2: Workspace の作成/更新

    Workers->>D1: INSERT INTO workspaces<br/>(id, workspace_name, workspace_icon)<br/>ON CONFLICT(id) DO UPDATE SET ...
    activate D1
    D1-->>Workers: OK
    deactivate D1

    Note over Workers,NotionAPI: Phase 3: データベースの検索/作成

    alt 既存連携が存在する場合
        Workers->>NotionAPI: GET /v1/databases/{database_id}
        activate NotionAPI

        alt データベースが存在する（200 OK）
            NotionAPI-->>Workers: { id: database_id, parent: {...}, ... }
            deactivate NotionAPI
            Workers->>Workers: databaseId = existing.id<br/>pageId = existing.parent.page_id
        else データベースが存在しない（404）
            NotionAPI-->>Workers: 404 Not Found
            deactivate NotionAPI
            Note over Workers: 新規作成に進む
        end
    end

    alt 既存データベースが存在しない、または既存連携がない場合
        Workers->>NotionAPI: POST /v1/databases<br/>{ parent: { type: "workspace" },<br/>  title: "ArXiv Papers",<br/>  properties: {...} }
        activate NotionAPI
        NotionAPI-->>Workers: { id: database_id, parent: {...} }
        deactivate NotionAPI
        Workers->>Workers: databaseId = database.id<br/>pageId = null (workspace直下)
    end

    Note over Workers,NotionAPI: Phase 4: Integration の保存

    alt 既存連携が存在する場合（更新）
        Workers->>D1: UPDATE integrations<br/>SET workspace_id = ?,<br/>    access_token = ?,<br/>    refresh_token = ?,<br/>    token_expires_at = ?,<br/>    database_id = ?,<br/>    parent_page_id = ?<br/>WHERE bot_id = ?
        activate D1
        D1-->>Workers: OK
        deactivate D1
    else 既存連携が存在しない場合（新規作成）
        Workers->>D1: INSERT INTO integrations<br/>(bot_id, workspace_id, access_token,<br/> refresh_token, token_expires_at,<br/> database_id, parent_page_id)<br/>VALUES (?, ?, ?, ?, ?, ?, ?)<br/>ON CONFLICT(bot_id) DO UPDATE SET ...
        activate D1
        D1-->>Workers: OK
        deactivate D1
    end

    Workers-->>Workers: 成功ページにリダイレクト
    deactivate Workers
```

### 2.2 エラーケース

```mermaid
sequenceDiagram
    participant Workers as Cloudflare Workers
    participant D1 as Cloudflare D1
    participant NotionAPI as Notion API

    Note over Workers,NotionAPI: ケース1: 既存データベース取得時のエラー（404以外）

    activate Workers
    Workers->>D1: SELECT * FROM integrations<br/>WHERE bot_id = ?
    activate D1
    D1-->>Workers: { database_id: "xxx", ... }
    deactivate D1

    Workers->>NotionAPI: GET /v1/databases/{database_id}
    activate NotionAPI
    NotionAPI-->>Workers: 403 Forbidden<br/>(権限エラー)
    deactivate NotionAPI

    Workers-->>Workers: NotionApiError をスロー<br/>処理中断
    deactivate Workers

    Note over Workers,NotionAPI: ケース2: D1 更新失敗

    activate Workers
    Workers->>D1: UPDATE integrations SET ...
    activate D1
    D1-->>Workers: Error<br/>(データベースエラー)
    deactivate D1

    Workers-->>Workers: DatabaseError をスロー<br/>処理中断
    deactivate Workers

    Note over Workers,NotionAPI: ケース3: データベース作成失敗

    activate Workers
    Workers->>NotionAPI: POST /v1/databases
    activate NotionAPI
    NotionAPI-->>Workers: 400 Bad Request<br/>{ message: "Invalid properties" }
    deactivate NotionAPI

    Workers-->>Workers: NotionApiError をスロー<br/>処理中断
    deactivate Workers
```

---

## 4. データベース検索・作成フロー（旧実装参考）

### 3.1 テンプレートからのデータベース検索

```mermaid
sequenceDiagram
    participant Workers as Cloudflare Workers
    participant NotionAPI as Notion API
    participant D1 as Cloudflare D1
    participant User as ユーザー<br/>(Browser)

    Note over Workers,User: 前提: OAuth 完了済み<br/>(access_token, duplicated_template_id 取得済み)

    activate Workers

    Workers->>Workers: notionClient = new Client({ auth: access_token })

    Workers->>NotionAPI: POST /v1/search<br/>{ filter: { value: "database" } }
    activate NotionAPI
    NotionAPI-->>Workers: { results: [database1, database2, ...] }
    deactivate NotionAPI

    Workers->>Workers: database = results.find(<br/>  db => db.title === "ArXiv Papers"<br/>)

    alt データベースが見つかった
        Workers->>Workers: database_id = database.id
    else データベースが見つからない
        Workers->>NotionAPI: POST /v1/databases<br/>{ parent: { page_id: duplicated_template_id },<br/>  title: "ArXiv Papers", properties }
        activate NotionAPI
        NotionAPI-->>Workers: { id: database_id, ... }
        deactivate NotionAPI
    end

    Workers->>D1: INSERT INTO integrations<br/>(bot_id, workspace_id, access_token,<br/> refresh_token, database_id, ...)
    activate D1
    D1-->>Workers: OK
    deactivate D1

    Workers->>Workers: html = generateSuccessPage(<br/>  database_id,<br/>  workspace_id,<br/>  WORKER_URL<br/>)

    Workers-->>User: 200 OK<br/>Content-Type: text/html<br/><成功ページ>
    deactivate Workers

    Note over User: 成功ページには以下を表示:<br/>- データベース URL<br/>- Webhook URL<br/>- Automation 設定手順
```

### 2.2 エラーケース

```mermaid
sequenceDiagram
    participant Workers as Cloudflare Workers
    participant NotionAPI as Notion API
    participant D1 as Cloudflare D1
    participant User as ユーザー

    Note over Workers,User: ケース1: データベース検索失敗

    activate Workers
    Workers->>NotionAPI: POST /v1/search
    activate NotionAPI
    NotionAPI-->>Workers: 403 Forbidden
    deactivate NotionAPI
    Workers-->>User: 500 Internal Server Error<br/>{ error: "Failed to search databases" }
    deactivate Workers

    Note over Workers,User: ケース2: D1 保存失敗

    activate Workers
    Workers->>NotionAPI: POST /v1/search
    activate NotionAPI
    NotionAPI-->>Workers: { results: [database] }
    deactivate NotionAPI

    Workers->>D1: INSERT INTO integrations
    activate D1
    D1-->>Workers: Error
    deactivate D1
    Workers-->>User: 500 Internal Server Error<br/>{ error: "Failed to save integration" }
    deactivate Workers
```

---

## 5. Webhook 受信フロー

### 3.1 正常フロー

```mermaid
sequenceDiagram
    participant User as ユーザー<br/>(Notion UI)
    participant Automation as Notion Automation
    participant Workers as Cloudflare Workers
    participant D1 as Cloudflare D1
    participant ArxivAPI as ArXiv API
    participant NotionAPI as Notion API

    Note over User,NotionAPI: Phase 1: トリガー発火

    User->>User: Link プロパティを更新<br/>https://arxiv.org/abs/2301.12345

    User->>Automation: ページ更新イベント
    activate Automation

    Automation->>Automation: トリガー条件チェック<br/>(Link プロパティが変更された)

    Automation->>Workers: POST /notion/webhook<br/>{ workspace_id, page_id, link }
    deactivate Automation

    Note over User,NotionAPI: Phase 2: バリデーション

    activate Workers

    Workers->>Workers: payload 検証<br/>- workspace_id 存在確認<br/>- page_id 存在確認<br/>- link 存在確認

    Workers->>Workers: validateArxivUrl(link)<br/>正規表現マッチング

    Workers->>Workers: arxivId = extractArxivId(link)<br/>→ "2301.12345"

    Note over User,NotionAPI: Phase 3: Integration 取得

    Workers->>D1: SELECT * FROM integrations<br/>WHERE workspace_id = ?
    activate D1
    D1-->>Workers: { access_token, database_id,<br/>token_expires_at, ... }
    deactivate D1

    Workers->>Workers: トークン有効期限チェック

    alt トークンが期限切れ
        Workers->>Workers: refreshToken(refresh_token)
        Workers->>D1: UPDATE integrations<br/>SET access_token = ?, refresh_token = ?
        activate D1
        D1-->>Workers: OK
        deactivate D1
    end

    Note over Workers: 次のフェーズへ続く<br/>(ArXiv 同期)

    deactivate Workers
```

### 3.2 エラーケース

```mermaid
sequenceDiagram
    participant Automation as Notion Automation
    participant Workers as Cloudflare Workers
    participant D1 as Cloudflare D1

    Note over Automation,D1: ケース1: payload が不正

    Automation->>Workers: POST /notion/webhook<br/>{ workspace_id, page_id }<br/>(link が欠落)
    activate Workers
    Workers-->>Automation: 400 Bad Request<br/>{ error: "Invalid payload" }
    deactivate Workers

    Note over Automation,D1: ケース2: ArXiv URL が不正

    Automation->>Workers: POST /notion/webhook<br/>{ ..., link: "https://example.com" }
    activate Workers
    Workers->>Workers: validateArxivUrl(link) → false
    Workers-->>Automation: 400 Bad Request<br/>{ error: "Invalid ArXiv URL" }
    deactivate Workers

    Note over Automation,D1: ケース3: Integration 未登録

    Automation->>Workers: POST /notion/webhook<br/>{ workspace_id: unknown, ... }
    activate Workers
    Workers->>D1: SELECT * FROM integrations<br/>WHERE workspace_id = ?
    activate D1
    D1-->>Workers: null
    deactivate D1
    Workers-->>Automation: 404 Not Found<br/>{ error: "Integration not found" }
    deactivate Workers
```

---

## 6. ArXiv 同期フロー

### 4.1 正常フロー

```mermaid
sequenceDiagram
    participant Workers as Cloudflare Workers
    participant ArxivAPI as ArXiv API
    participant NotionAPI as Notion API
    participant Automation as Notion Automation

    Note over Workers,Automation: 前提: Webhook 受信済み<br/>(arxivId, config 取得済み)

    activate Workers

    Note over Workers,Automation: Phase 1: ArXiv データ取得

    Workers->>ArxivAPI: GET /api/query<br/>?id_list=2301.12345&max_results=1
    activate ArxivAPI

    Note over ArxivAPI: Atom XML 生成

    ArxivAPI-->>Workers: 200 OK<br/>Content-Type: application/atom+xml<br/><feed>...</feed>
    deactivate ArxivAPI

    Workers->>Workers: parseArxivXml(xml)<br/>→ ArxivPaper {<br/>  title,<br/>  authors: [],<br/>  summary,<br/>  link,<br/>  publishedYear<br/>}

    Note over Workers,Automation: Phase 2: データ変換

    Workers->>Workers: buildNotionProperties(paper)<br/>- Title → title型<br/>- Authors → rich_text型<br/>- Summary → rich_text型 (分割)<br/>- Link → url型<br/>- Publication Year → number型

    Note over Workers,Automation: Phase 3: Notion 更新

    Workers->>Workers: notionClient = new Client({ auth: accessToken })

    Workers->>NotionAPI: PATCH /v1/pages/{page_id}<br/>{ properties: { ... } }
    activate NotionAPI

    Note over NotionAPI: ページプロパティ更新

    NotionAPI-->>Workers: 200 OK<br/>{ id: page_id, properties: { ... } }
    deactivate NotionAPI

    Workers->>Workers: response = {<br/>  success: true,<br/>  page_id,<br/>  updated_at: new Date().toISOString()<br/>}

    Workers-->>Automation: 200 OK<br/>Content-Type: application/json<br/>{ success: true, ... }
    deactivate Workers

    Note over Automation: Automation 完了
```

### 4.2 データ変換詳細

```mermaid
sequenceDiagram
    participant Workers as Cloudflare Workers
    participant Parser as XML Parser
    participant Transformer as Data Transformer

    activate Workers

    Workers->>Parser: parseArxivXml(xmlString)
    activate Parser

    Parser->>Parser: extract <title>
    Parser->>Parser: extract <author><name> (複数)
    Parser->>Parser: extract <summary>
    Parser->>Parser: extract <id> (URL)
    Parser->>Parser: extract <published> (YYYY-MM-DD)

    Parser-->>Workers: {<br/>  title: "...",<br/>  authors: ["A", "B", "C"],<br/>  summary: "...",<br/>  link: "https://...",<br/>  published: "2023-01-15"<br/>}
    deactivate Parser

    Workers->>Transformer: transformToNotionProperties(data)
    activate Transformer

    Transformer->>Transformer: title → normalize whitespace
    Transformer->>Transformer: authors → join with ", "
    Transformer->>Transformer: summary → normalize whitespace
    Transformer->>Transformer: summary → split if > 2000 chars
    Transformer->>Transformer: published → extract year (2023)

    Transformer-->>Workers: {<br/>  Title: { title: [...] },<br/>  Authors: { rich_text: [...] },<br/>  Summary: { rich_text: [...] },<br/>  Link: { url: "..." },<br/>  "Publication Year": { number: 2023 }<br/>}
    deactivate Transformer

    deactivate Workers
```

### 4.3 エラーケース

```mermaid
sequenceDiagram
    participant Workers as Cloudflare Workers
    participant ArxivAPI as ArXiv API
    participant NotionAPI as Notion API
    participant Automation as Notion Automation

    Note over Workers,Automation: ケース1: ArXiv 論文が見つからない

    activate Workers
    Workers->>ArxivAPI: GET /api/query?id_list=9999.99999
    activate ArxivAPI
    ArxivAPI-->>Workers: 200 OK<br/><feed><entry>なし</entry></feed>
    deactivate ArxivAPI
    Workers->>Workers: parseArxivXml(xml) → null
    Workers-->>Automation: 404 Not Found<br/>{ error: "Paper not found" }
    deactivate Workers

    Note over Workers,Automation: ケース2: ArXiv API タイムアウト

    activate Workers
    Workers->>ArxivAPI: GET /api/query?id_list=2301.12345
    activate ArxivAPI
    Note over ArxivAPI: 10秒経過...
    ArxivAPI--xWorkers: (タイムアウト)
    deactivate ArxivAPI

    Workers->>Workers: リトライ (1秒待機)

    Workers->>ArxivAPI: GET /api/query?id_list=2301.12345 (リトライ)
    activate ArxivAPI
    ArxivAPI-->>Workers: 200 OK<br/><feed>...</feed>
    deactivate ArxivAPI

    Workers->>NotionAPI: PATCH /v1/pages/{page_id}
    activate NotionAPI
    NotionAPI-->>Workers: 200 OK
    deactivate NotionAPI

    Workers-->>Automation: 200 OK<br/>{ success: true }
    deactivate Workers

    Note over Workers,Automation: ケース3: Notion API エラー

    activate Workers
    Workers->>ArxivAPI: GET /api/query?id_list=2301.12345
    activate ArxivAPI
    ArxivAPI-->>Workers: 200 OK
    deactivate ArxivAPI

    Workers->>NotionAPI: PATCH /v1/pages/{page_id}
    activate NotionAPI
    NotionAPI-->>Workers: 400 Bad Request<br/>{ message: "Invalid properties" }
    deactivate NotionAPI

    Workers-->>Automation: 500 Internal Server Error<br/>{ error: "Failed to update page" }
    deactivate Workers
```

---

## 7. トークンリフレッシュフロー

### 5.1 Cron Triggers による定期リフレッシュ

```mermaid
sequenceDiagram
    participant Cron as Cloudflare<br/>Cron Triggers
    participant Workers as Cloudflare Workers<br/>(scheduled handler)
    participant D1 as Cloudflare D1
    participant NotionAPI as Notion API

    Note over Cron,NotionAPI: 6時間ごとに実行

    Cron->>Workers: scheduled event<br/>{ scheduledTime, cron }
    activate Workers

    Workers->>D1: SELECT * FROM integrations<br/>WHERE token_expires_at < datetime('now', '+24 hours')<br/>OR token_expires_at IS NULL
    activate D1
    D1-->>Workers: [integration1, integration2, ...]
    deactivate D1

    loop 各 Integration
        Workers->>NotionAPI: POST /v1/oauth/token<br/>{ grant_type: "refresh_token",<br/>  refresh_token }
        activate NotionAPI

        alt リフレッシュ成功
            NotionAPI-->>Workers: { access_token, refresh_token,<br/>  bot_id, workspace_id }
            deactivate NotionAPI

            Workers->>D1: UPDATE integrations<br/>SET access_token = ?,<br/>    refresh_token = ?,<br/>    token_expires_at = datetime('now', '+7 days')<br/>WHERE bot_id = ?
            activate D1
            D1-->>Workers: OK
            deactivate D1

            Workers->>Workers: successCount++
        else リフレッシュ失敗
            NotionAPI-->>Workers: 401 Unauthorized
            deactivate NotionAPI

            Workers->>Workers: failedCount++<br/>errors.push({ bot_id, error })
        end
    end

    Workers->>Workers: console.log({<br/>  total, success, failed, errors<br/>})

    Workers-->>Cron: 完了
    deactivate Workers
```

### 5.2 手動リフレッシュ（オプション）

```mermaid
sequenceDiagram
    participant Client as クライアント
    participant Workers as Cloudflare Workers
    participant D1 as Cloudflare D1
    participant NotionAPI as Notion API

    Client->>Workers: POST /notion/refresh-token<br/>{ workspace_id }
    activate Workers

    Workers->>D1: SELECT * FROM integrations<br/>WHERE workspace_id = ?
    activate D1
    D1-->>Workers: { bot_id, refresh_token, ... }
    deactivate D1

    Workers->>NotionAPI: POST /v1/oauth/token<br/>{ grant_type: "refresh_token",<br/>  refresh_token }
    activate NotionAPI
    NotionAPI-->>Workers: { access_token, refresh_token }
    deactivate NotionAPI

    Workers->>D1: UPDATE integrations<br/>SET access_token = ?,<br/>    refresh_token = ?,<br/>    token_expires_at = datetime('now', '+7 days')<br/>WHERE bot_id = ?
    activate D1
    D1-->>Workers: OK
    deactivate D1

    Workers-->>Client: 200 OK<br/>{ success: true, message: "Token refreshed" }
    deactivate Workers
```

### 5.3 Webhook 処理時の自動リフレッシュ

```mermaid
sequenceDiagram
    participant Automation as Notion Automation
    participant Workers as Cloudflare Workers
    participant D1 as Cloudflare D1
    participant NotionAPI as Notion API

    Automation->>Workers: POST /notion/webhook<br/>{ workspace_id, page_id, link }
    activate Workers

    Workers->>D1: SELECT * FROM integrations<br/>WHERE workspace_id = ?
    activate D1
    D1-->>Workers: { access_token, token_expires_at, ... }
    deactivate D1

    Workers->>Workers: if (token_expires_at < now())<br/>  needsRefresh = true

    alt トークンが期限切れ
        Workers->>NotionAPI: POST /v1/oauth/token<br/>{ grant_type: "refresh_token", ... }
        activate NotionAPI
        NotionAPI-->>Workers: { access_token, refresh_token }
        deactivate NotionAPI

        Workers->>D1: UPDATE integrations<br/>SET access_token = ?, refresh_token = ?
        activate D1
        D1-->>Workers: OK
        deactivate D1
    end

    Note over Workers: 新しい access_token で<br/>Notion API を呼び出し

    Workers->>NotionAPI: PATCH /v1/pages/{page_id}
    activate NotionAPI
    NotionAPI-->>Workers: 200 OK
    deactivate NotionAPI

    Workers-->>Automation: 200 OK
    deactivate Workers
```

---

## 8. エラーハンドリングフロー

### 5.1 エラーキャッチと処理

```mermaid
sequenceDiagram
    participant Client as クライアント
    participant Middleware as Error Handler<br/>Middleware
    participant Route as Route Handler
    participant Service as Service Layer
    participant Logger as Logger

    Client->>Middleware: HTTP Request
    activate Middleware

    Middleware->>Route: next()
    activate Route

    Route->>Service: businessLogic()
    activate Service

    Service->>Service: エラー発生<br/>(例: NotionApiError)
    Service--xRoute: throw new NotionApiError(...)
    deactivate Service

    Route--xMiddleware: (エラー伝播)
    deactivate Route

    Middleware->>Middleware: catch (error)

    Middleware->>Logger: console.error({<br/>  timestamp,<br/>  path,<br/>  method,<br/>  error: {<br/>    name,<br/>    message,<br/>    stack<br/>  }<br/>})
    activate Logger
    Logger-->>Middleware: ログ出力完了
    deactivate Logger

    Middleware->>Middleware: if (error instanceof AppError)<br/>  statusCode = error.statusCode<br/>  errorCode = error.code<br/>else<br/>  statusCode = 500<br/>  errorCode = "INTERNAL_ERROR"

    Middleware-->>Client: HTTP Response<br/>Status: statusCode<br/>{ error: { code, message } }
    deactivate Middleware
```

### 5.2 リトライフロー

```mermaid
sequenceDiagram
    participant Service as Service Layer
    participant API as External API
    participant Retry as Retry Logic

    Service->>Retry: retryWithBackoff(fn, maxRetries=3)
    activate Retry

    Note over Retry: 試行 1
    Retry->>API: fn() - API Call
    activate API
    API-->>Retry: 503 Service Unavailable
    deactivate API

    Retry->>Retry: isRetryableError(error) → true
    Retry->>Retry: wait(1000ms)

    Note over Retry: 試行 2
    Retry->>API: fn() - API Call (リトライ)
    activate API
    API-->>Retry: 503 Service Unavailable
    deactivate API

    Retry->>Retry: isRetryableError(error) → true
    Retry->>Retry: wait(2000ms)

    Note over Retry: 試行 3
    Retry->>API: fn() - API Call (リトライ)
    activate API
    API-->>Retry: 200 OK<br/>{ data: ... }
    deactivate API

    Retry-->>Service: { data: ... }
    deactivate Retry
```

### 5.3 リトライ失敗フロー

```mermaid
sequenceDiagram
    participant Service as Service Layer
    participant API as External API
    participant Retry as Retry Logic

    Service->>Retry: retryWithBackoff(fn, maxRetries=3)
    activate Retry

    Note over Retry: 試行 1
    Retry->>API: fn() - API Call
    activate API
    API-->>Retry: 503 Service Unavailable
    deactivate API
    Retry->>Retry: wait(1000ms)

    Note over Retry: 試行 2
    Retry->>API: fn() - API Call
    activate API
    API-->>Retry: 503 Service Unavailable
    deactivate API
    Retry->>Retry: wait(2000ms)

    Note over Retry: 試行 3 (最終)
    Retry->>API: fn() - API Call
    activate API
    API-->>Retry: 503 Service Unavailable
    deactivate API

    Retry--xService: throw lastError<br/>(ArxivApiError: Service Unavailable)
    deactivate Retry

    Note over Service: エラーハンドリング<br/>ミドルウェアへ伝播
```

---

## 9. 全体統合フロー

### 6.1 初回セットアップから同期まで

```mermaid
sequenceDiagram
    participant User as ユーザー
    participant Workers as Workers
    participant Notion as Notion
    participant KV as KV
    participant ArXiv as ArXiv

    rect rgb(200, 220, 255)
        Note over User,ArXiv: Step 1: OAuth 認証 & DB 作成
        User->>Workers: /notion/connect
        Workers->>Notion: OAuth フロー
        Notion-->>Workers: access_token
        Workers->>Notion: データベース作成
        Notion-->>Workers: database_id
        Workers->>KV: 設定保存
        Workers-->>User: 成功ページ
    end

    rect rgb(200, 255, 220)
        Note over User,ArXiv: Step 2: Automation 設定 (手動)
        User->>Notion: Automation 作成<br/>Webhook URL 設定
    end

    rect rgb(255, 220, 200)
        Note over User,ArXiv: Step 3: 論文追加 & 自動同期
        User->>Notion: Link プロパティ入力
        Notion->>Workers: Webhook POST
        Workers->>KV: 設定取得
        Workers->>ArXiv: 論文データ取得
        ArXiv-->>Workers: 論文情報
        Workers->>Notion: ページ更新
        Notion-->>Workers: OK
        Workers-->>Notion: 成功レスポンス
    end

    Note over User,ArXiv: 以降、Step 3 を繰り返し
```

---

## 10. 補足情報

### 7.1 タイミング図

```mermaid
gantt
    title ArXiv 同期処理のタイミング
    dateFormat  HH:mm:ss
    axisFormat %H:%M:%S

    section User Action
    Link 入力           :done, user1, 00:00:00, 1s

    section Notion
    Automation トリガー  :done, notion1, 00:00:01, 1s
    Webhook POST       :done, notion2, 00:00:02, 1s

    section Workers
    Webhook 受信        :active, worker1, 00:00:03, 0.5s
    バリデーション       :active, worker2, 00:00:03.5, 0.5s
    KV 取得            :active, worker3, 00:00:04, 0.1s
    ArXiv API 呼び出し   :active, worker4, 00:00:04.1, 1.5s
    データ変換          :active, worker5, 00:00:05.6, 0.2s
    Notion API 呼び出し  :active, worker6, 00:00:05.8, 0.8s
    レスポンス返却       :active, worker7, 00:00:06.6, 0.1s

    section Total
    合計処理時間         :milestone, total, 00:00:06.7, 0s
```

### 7.2 シーケンス図の凡例

| 記号                      | 意味                 |
| ------------------------- | -------------------- |
| `→`                       | 同期呼び出し         |
| `-->>`                    | 同期レスポンス       |
| `--x`                     | エラーレスポンス     |
| `activate` / `deactivate` | 処理中の状態         |
| `Note over`               | 補足説明             |
| `rect`                    | フェーズのグループ化 |

---

## 11. 参考資料

### 8.1 関連ドキュメント

- [requirements.md](./requirements.md) - 要件定義書
- [architecture.md](./architecture.md) - アーキテクチャ設計書
- [types.md](./types.md) - TypeScript 型定義仕様

### 8.2 外部リソース

- [Mermaid Documentation](https://mermaid.js.org/) - シーケンス図の記法
- [Notion API Documentation](https://developers.notion.com/) - Notion API 仕様
- [ArXiv API Documentation](https://info.arxiv.org/help/api/index.html) - ArXiv API 仕様

---

## 12. 変更履歴

| バージョン | 日付       | 変更内容                                                                          | 担当者 |
| ---------- | ---------- | --------------------------------------------------------------------------------- | ------ |
| 2.0.0      | 2025-11-23 | D1 対応、テンプレート OAuth 対応、トークンリフレッシュフロー追加、KV を D1 に移行 | -      |
| 1.0.0      | 2025-11-22 | 初版作成                                                                          | -      |

---

**このドキュメントは、ArXiv Notion 同期システムの動作フローを可視化し、実装時の理解を助けるために作成された。**
