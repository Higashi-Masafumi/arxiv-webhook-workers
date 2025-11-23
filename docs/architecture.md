# Notion × ArXiv 自動同期システム アーキテクチャ設計書

## ドキュメント情報

- **バージョン**: 2.0.0
- **最終更新日**: 2025-11-23
- **対象システム**: ArXiv Webhook Workers
- **関連ドキュメント**: [requirements.md](./requirements.md)
- **主な変更**: D1 導入、Cron Triggers 追加、Token Refresh Service 追加

---

## 1. システムアーキテクチャ概要

### 1.1 全体構成図（テキストベース）

```
┌─────────────────────────────────────────────────────────────────┐
│                         User (Browser)                          │
└────────────┬────────────────────────────────────┬────────────────┘
             │                                    │
             │ 1. OAuth Flow                      │ 2. Notion UI
             │                                    │
┌────────────▼────────────────────────────────────▼────────────────┐
│                      Notion Platform                             │
│  ┌──────────────────┐              ┌─────────────────────────┐  │
│  │  OAuth Server    │              │  Notion Automations     │  │
│  │  (Authorization) │              │  (HTTP Request Action)  │  │
│  │  + Template      │              │                         │  │
│  └──────────────────┘              └─────────────────────────┘  │
└────────────┬────────────────────────────────────┬────────────────┘
             │                                    │
             │ 3. Access + Refresh Token          │ 4. Webhook POST
             │                                    │
┌────────────▼────────────────────────────────────▼────────────────┐
│              Cloudflare Workers (Hono App)                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Routes Layer                                            │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │   │
│  │  │ /notion/    │  │ /notion/     │  │ /notion/       │  │   │
│  │  │ connect     │  │ oauth/       │  │ webhook        │  │   │
│  │  │             │  │ callback     │  │                │  │   │
│  │  └─────────────┘  └──────────────┘  └────────────────┘  │   │
│  │  ┌─────────────┐  ┌──────────────┐                      │   │
│  │  │ /notion/    │  │ scheduled    │                      │   │
│  │  │ refresh-    │  │ (Cron)       │                      │   │
│  │  │ token       │  │              │                      │   │
│  │  └─────────────┘  └──────────────┘                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Services Layer                                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │ Notion Auth  │  │ Notion DB    │  │ ArXiv Sync   │  │   │
│  │  │ Service      │  │ Service      │  │ Service      │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │
│  │  ┌──────────────┐  ┌──────────────┐                    │   │
│  │  │ Integration  │  │ Token        │                    │   │
│  │  │ Service      │  │ Refresh Svc  │                    │   │
│  │  └──────────────┘  └──────────────┘                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Libs Layer                                              │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │   │
│  │  │ Notion       │  │ ArXiv        │  │ D1 Client    │  │   │
│  │  │ Client       │  │ Client       │  │              │  │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────┬──────────────┬──────────────────────┬──────────────┘
             │              │                      │
             │ 5. KV R/W    │ 6. D1 R/W            │ 7. HTTP Request
             │ (OAuth State)│ (Integrations)       │
┌────────────▼──────────┐ ┌─▼──────────────────┐ ┌─▼────────────────┐
│   Cloudflare KV       │ │   Cloudflare D1    │ │   ArXiv API      │
│   (OAuth State Only)  │ │   (Token Storage)  │ │ (export.arxiv.org)│
└───────────────────────┘ └────────────────────┘ └──────────────────┘
                            ▲
                            │ 8. Cron Triggers (6h)
                            │
                    ┌───────┴───────┐
                    │ Cloudflare    │
                    │ Cron Triggers │
                    └───────────────┘
```

### 1.2 データフロー概要

1. **OAuth 認証フロー**: User → Workers → Notion OAuth → Workers → D1 (Integration 保存)
2. **DB 検索・作成フロー**: Workers → Notion API (search) → D1 (database_id 保存)
3. **Webhook 受信フロー**: Notion Automation → Workers → D1 (Integration 取得) → ArXiv API → Notion API
4. **トークンリフレッシュフロー**: Cron Triggers → Workers → D1 (期限切れ近いトークン取得) → Notion API → D1 (更新)

---

## 2. ディレクトリ構造

### 2.1 推奨プロジェクト構成

```
arxiv-webhook-workers/
├── src/
│   ├── index.ts                    # エントリーポイント（Hono アプリ初期化）
│   ├── scheduled.ts                # Cron Triggers ハンドラー
│   ├── routes/
│   │   └── notion/
│   │       ├── connect.ts          # GET /notion/connect
│   │       ├── callback.ts         # GET /notion/oauth/callback
│   │       ├── webhook.ts          # POST /notion/webhook
│   │       └── refreshToken.ts     # POST /notion/refresh-token
│   ├── services/
│   │   ├── notionAuthService.ts    # OAuth 認証・トークンリフレッシュロジック
│   │   ├── notionDatabaseService.ts # DB 検索・作成・更新ロジック
│   │   ├── arxivService.ts         # ArXiv API 連携ロジック
│   │   ├── integrationService.ts   # D1 Integration 管理ロジック
│   │   └── tokenRefreshService.ts  # トークンリフレッシュロジック
│   ├── libs/
│   │   ├── notionClient.ts         # Notion SDK ラッパー
│   │   ├── arxivClient.ts          # ArXiv API クライアント
│   │   └── d1Client.ts             # D1 クライアントヘルパー
│   ├── types/
│   │   ├── notion.ts               # Notion 関連型定義
│   │   ├── arxiv.ts                # ArXiv 関連型定義
│   │   ├── webhook.ts              # Webhook 関連型定義
│   │   ├── d1.ts                   # D1 データベース型定義
│   │   ├── scheduled.ts            # Cron Triggers 型定義
│   │   └── bindings.ts             # Cloudflare Bindings 型定義
│   ├── utils/
│   │   ├── errors.ts               # カスタムエラークラス
│   │   ├── validation.ts           # 入力検証ユーティリティ
│   │   └── logger.ts               # ロギングユーティリティ
│   └── middleware/
│       ├── errorHandler.ts         # エラーハンドリングミドルウェア
│       └── requestLogger.ts        # リクエストログミドルウェア
├── docs/
│   ├── requirements.md             # 要件定義書
│   ├── architecture.md             # アーキテクチャ設計書（本ドキュメント）
│   ├── sequences.md                # シーケンス図
│   └── types.md                    # 型定義仕様
├── migrations/
│   └── 0001_initial.sql            # D1 初期マイグレーション
├── public/
│   └── success.html                # OAuth 成功ページ（オプション）
├── package.json
├── tsconfig.json
├── wrangler.jsonc                  # Cloudflare Workers 設定（D1, Cron 含む）
└── README.md
```

### 2.2 各モジュールの責務

#### 2.2.1 Routes Layer

**責務**: HTTP リクエストの受信とレスポンスの返却

- `connect.ts`: OAuth 認可フローの開始
- `callback.ts`: OAuth コールバック処理と DB 作成
- `webhook.ts`: Notion Automation からの Webhook 受信

**原則**:

- ビジネスロジックは含めない
- Services Layer への委譲のみ
- バリデーションは最小限（型チェック程度）

#### 2.2.2 Services Layer

**責務**: ビジネスロジックの実装

- `notionAuthService.ts`: OAuth トークン取得・リフレッシュ、state 管理
- `notionDatabaseService.ts`: DB 検索・作成、ページ更新
- `arxivService.ts`: ArXiv API 呼び出し、データ変換
- `integrationService.ts`: D1 への Integration 保存・取得・更新
- `tokenRefreshService.ts`: トークンリフレッシュロジック、有効期限チェック

**原則**:

- 単一責任の原則に従う
- 外部 API 呼び出しは Libs Layer に委譲
- エラーハンドリングを適切に実装
- D1 操作は integrationService に集約

#### 2.2.3 Libs Layer

**責務**: 外部 API クライアントのラッパー

- `notionClient.ts`: Notion SDK の初期化と基本操作
- `arxivClient.ts`: ArXiv API の HTTP クライアント
- `d1Client.ts`: D1 クエリヘルパー、トランザクション管理

**原則**:

- 外部ライブラリの詳細を隠蔽
- リトライ・タイムアウト処理を実装
- エラーを統一的な形式に変換

#### 2.2.4 Types Layer

**責務**: TypeScript 型定義の集約

**原則**:

- 外部 API のレスポンス型を定義
- 内部データ構造の型を定義
- 型の再利用性を重視

#### 2.2.5 Utils Layer

**責務**: 汎用的なユーティリティ関数

**原則**:

- 純粋関数として実装
- 副作用を持たない
- テスタビリティを重視

#### 2.2.6 Middleware Layer

**責務**: 横断的関心事の処理

**原則**:

- すべてのリクエストに適用される処理
- エラーハンドリングの統一
- ロギングの統一

---

## 3. コンポーネント詳細設計

### 3.1 Routes Layer

#### 3.1.1 connect.ts

```typescript
import { Hono } from "hono";
import type { Bindings } from "../types/bindings";
import { NotionAuthService } from "../services/notionAuthService";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/notion/connect", async (c) => {
  const authService = new NotionAuthService(c.env);
  const authUrl = await authService.generateAuthUrl();

  return c.redirect(authUrl);
});

export default app;
```

**依存関係**:

- `NotionAuthService`: OAuth URL 生成（テンプレート対応）

**変更点**:

- `parent_page_id` パラメータを削除（テンプレート機能を使用）

#### 3.1.2 callback.ts

```typescript
import { Hono } from "hono";
import type { Bindings } from "../types/bindings";
import { NotionAuthService } from "../services/notionAuthService";
import { NotionDatabaseService } from "../services/notionDatabaseService";
import { IntegrationService } from "../services/integrationService";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/notion/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json({ error: "Invalid callback parameters" }, 400);
  }

  const authService = new NotionAuthService(c.env);
  const dbService = new NotionDatabaseService(c.env);
  const integrationService = new IntegrationService(c.env);

  // 1. State 検証
  await authService.verifyState(state);

  // 2. アクセストークン・リフレッシュトークン取得
  const tokenData = await authService.exchangeCodeForToken(code);

  // 3. Workspace 保存
  await integrationService.createWorkspace({
    id: tokenData.workspace_id,
    workspace_name: tokenData.workspace_name,
    workspace_icon: tokenData.workspace_icon,
  });

  // 4. データベース検索または作成
  const database = await dbService.findOrCreateArxivDatabase(
    tokenData.access_token,
    tokenData.duplicated_template_id
  );

  // 5. Integration 保存
  await integrationService.createIntegration({
    bot_id: tokenData.bot_id,
    workspace_id: tokenData.workspace_id,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_expires_at: new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString(),
    database_id: database.id,
    duplicated_template_id: tokenData.duplicated_template_id,
  });

  // 6. 成功ページ表示
  return c.html(generateSuccessPage(database.id, tokenData.workspace_id));
});

export default app;
```

**依存関係**:

- `NotionAuthService`: トークン交換、state 検証
- `NotionDatabaseService`: DB 検索・作成
- `IntegrationService`: D1 への保存

**変更点**:

- `WorkspaceConfigService` → `IntegrationService` に変更
- `refresh_token` の保存を追加
- `duplicated_template_id` の処理を追加
- データベース作成 → 検索または作成に変更

#### 3.1.3 webhook.ts

```typescript
import { Hono } from "hono";
import type { Bindings } from "../types/bindings";
import type { WebhookPayload } from "../types/webhook";
import { IntegrationService } from "../services/integrationService";
import { ArxivService } from "../services/arxivService";
import { NotionDatabaseService } from "../services/notionDatabaseService";
import { TokenRefreshService } from "../services/tokenRefreshService";
import { validateArxivUrl } from "../utils/validation";

const app = new Hono<{ Bindings: Bindings }>();

app.post("/notion/webhook", async (c) => {
  const payload: WebhookPayload = await c.req.json();

  // 1. バリデーション
  if (!payload.workspace_id || !payload.page_id || !payload.link) {
    return c.json({ error: "Invalid payload" }, 400);
  }

  if (!validateArxivUrl(payload.link)) {
    return c.json({ error: "Invalid ArXiv URL" }, 400);
  }

  // 2. Integration 取得
  const integrationService = new IntegrationService(c.env);
  const integration = await integrationService.getIntegrationByWorkspaceId(
    payload.workspace_id
  );

  if (!integration) {
    return c.json({ error: "Integration not found" }, 404);
  }

  // 3. トークン有効期限チェック & リフレッシュ
  const tokenRefreshService = new TokenRefreshService(c.env);
  if (tokenRefreshService.isTokenExpired(integration)) {
    await tokenRefreshService.refreshToken(integration.bot_id);
    // 再取得
    integration = await integrationService.getIntegrationByBotId(
      integration.bot_id
    );
  }

  // 4. ArXiv データ取得
  const arxivService = new ArxivService();
  const paper = await arxivService.fetchPaperByUrl(payload.link);

  // 5. Notion 更新
  const dbService = new NotionDatabaseService(c.env);
  await dbService.updatePage(integration.access_token, payload.page_id, paper);

  return c.json({
    success: true,
    page_id: payload.page_id,
    updated_at: new Date().toISOString(),
  });
});

export default app;
```

**依存関係**:

- `IntegrationService`: D1 から Integration 取得
- `TokenRefreshService`: トークン有効期限チェック・リフレッシュ
- `ArxivService`: 論文データ取得
- `NotionDatabaseService`: ページ更新

**変更点**:

- `WorkspaceConfigService` → `IntegrationService` に変更
- トークン有効期限チェックとリフレッシュを追加

#### 3.1.4 scheduled.ts

```typescript
import type { ScheduledEvent, Bindings } from "./types";
import { TokenRefreshService } from "./services/tokenRefreshService";

export default {
  async scheduled(
    event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<void> {
    const startTime = new Date().toISOString();

    console.log(`[Cron] Token refresh started at ${startTime}`);
    console.log(
      `[Cron] Scheduled time: ${new Date(event.scheduledTime).toISOString()}`
    );
    console.log(`[Cron] Cron expression: ${event.cron}`);

    try {
      const refreshService = new TokenRefreshService({ env });
      const result = await refreshService.refreshExpiringTokens();

      const endTime = new Date().toISOString();
      const duration = Date.now() - new Date(startTime).getTime();

      console.log(`[Cron] Token refresh completed:`, {
        total: result.total,
        success: result.success,
        failed: result.failed,
        duration,
      });

      if (result.failed > 0) {
        console.error(`[Cron] Refresh errors:`, result.errors);
      }
    } catch (error) {
      const endTime = new Date().toISOString();
      const duration = Date.now() - new Date(startTime).getTime();

      console.error(`[Cron] Token refresh failed:`, {
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      throw error;
    }
  },
};
```

**依存関係**:

- `TokenRefreshService`: トークンリフレッシュロジック

**実行頻度**: 6 時間ごと（`0 */6 * * *`）

**処理内容**:

1. 有効期限が 24 時間以内のトークンを取得
2. 各トークンをリフレッシュ
3. 結果をログ出力

### 3.2 Services Layer

#### 3.2.1 notionAuthService.ts

**主要メソッド**:

```typescript
class NotionAuthService {
  constructor(private env: Bindings) {}

  // OAuth URL 生成
  async generateAuthUrl(parentPageId: string): Promise<string>;

  // State 検証
  async verifyState(state: string): Promise<OAuthState>;

  // コードをトークンに交換
  async exchangeCodeForToken(code: string): Promise<TokenResponse>;

  // State を KV に保存
  private async saveState(state: string, data: OAuthState): Promise<void>;

  // State を KV から取得
  private async getState(state: string): Promise<OAuthState | null>;
}
```

**処理フロー**:

1. ランダムな state 生成（crypto.randomUUID()）
2. State と parentPageId を KV に保存（TTL: 600 秒）
3. Notion OAuth URL を構築して返却

#### 3.2.2 notionDatabaseService.ts

**主要メソッド**:

```typescript
class NotionDatabaseService {
  constructor(private env: Bindings) {}

  // ArXiv データベース作成
  async createArxivDatabase(
    accessToken: string,
    parentPageId: string
  ): Promise<DatabaseResponse>;

  // ページ更新
  async updatePage(
    accessToken: string,
    pageId: string,
    paper: ArxivPaper
  ): Promise<void>;

  // Rich Text 分割（2000文字制限対応）
  private splitRichText(text: string): RichTextItemRequest[];
}
```

**処理フロー**:

1. Notion Client を初期化（accessToken を使用）
2. `databases.create()` で DB 作成
3. `pages.update()` でページ更新

#### 3.2.3 arxivService.ts

**主要メソッド**:

```typescript
class ArxivService {
  // URL から論文データ取得
  async fetchPaperByUrl(url: string): Promise<ArxivPaper>;

  // ArXiv ID 抽出
  private extractArxivId(url: string): string | null;

  // ArXiv API 呼び出し
  private async fetchPaperById(arxivId: string): Promise<ArxivApiResponse>;

  // XML パース
  private parseArxivXml(xml: string): ArxivPaper;
}
```

**処理フロー**:

1. URL から ArXiv ID を抽出
2. ArXiv API に HTTP リクエスト
3. Atom XML をパース
4. `ArxivPaper` 型に変換

#### 3.2.4 workspaceConfigService.ts

**主要メソッド**:

```typescript
class WorkspaceConfigService {
  constructor(private env: Bindings) {}

  // 設定保存
  async saveConfig(workspaceId: string, config: WorkspaceConfig): Promise<void>;

  // 設定取得
  async getConfig(workspaceId: string): Promise<WorkspaceConfig | null>;

  // 設定削除（連携解除時）
  async deleteConfig(workspaceId: string): Promise<void>;

  // KV キー生成
  private getConfigKey(workspaceId: string): string;
}
```

**処理フロー**:

1. KV キーを生成（`notion:workspace:{workspaceId}:config`）
2. JSON シリアライズして KV に保存
3. 取得時は JSON デシリアライズ

### 3.3 Libs Layer

#### 3.3.1 notionClient.ts

```typescript
import { Client } from "@notionhq/client";

export function createNotionClient(accessToken: string): Client {
  return new Client({
    auth: accessToken,
    timeoutMs: 10000,
    logLevel: "error",
  });
}

export async function createDatabase(
  client: Client,
  params: CreateDatabaseParameters
): Promise<DatabaseObjectResponse> {
  try {
    return await client.databases.create(params);
  } catch (error) {
    throw new NotionApiError("Failed to create database", error);
  }
}

export async function updatePage(
  client: Client,
  params: UpdatePageParameters
): Promise<PageObjectResponse> {
  try {
    return await client.pages.update(params);
  } catch (error) {
    throw new NotionApiError("Failed to update page", error);
  }
}
```

**責務**:

- Notion SDK の初期化
- API 呼び出しのラッパー
- エラーハンドリング

#### 3.3.2 arxivClient.ts

```typescript
export class ArxivClient {
  private readonly baseUrl = "http://export.arxiv.org/api/query";
  private readonly timeout = 10000;

  async fetchPaper(arxivId: string): Promise<string> {
    const url = `${this.baseUrl}?id_list=${arxivId}&max_results=1`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ArxivApiError(`HTTP ${response.status}`, response.statusText);
      }

      return await response.text();
    } catch (error) {
      if (error.name === "AbortError") {
        throw new ArxivApiError("Request timeout", error);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

**責務**:

- ArXiv API への HTTP リクエスト
- タイムアウト処理
- エラーハンドリング

---

## 4. データフロー詳細

### 4.1 OAuth 認証フロー

```
1. User → GET /notion/connect?parent_page_id=xxx
   ↓
2. Workers: state 生成 → KV 保存
   ↓
3. Workers → 302 Redirect to Notion OAuth
   ↓
4. User: Notion でページ選択・承認
   ↓
5. Notion → GET /notion/oauth/callback?code=xxx&state=yyy
   ↓
6. Workers: state 検証（KV から取得）
   ↓
7. Workers → POST https://api.notion.com/v1/oauth/token
   ↓
8. Notion → { access_token, workspace_id, ... }
   ↓
9. Workers → POST https://api.notion.com/v1/databases
   ↓
10. Notion → { id: database_id, ... }
    ↓
11. Workers: config を KV に保存
    ↓
12. Workers → HTML Success Page
```

### 4.2 Webhook 処理フロー

```
1. User: Notion で Link プロパティを更新
   ↓
2. Notion Automation: トリガー発火
   ↓
3. Automation → POST /notion/webhook
   Body: { workspace_id, page_id, link }
   ↓
4. Workers: payload 検証
   ↓
5. Workers: KV から config 取得
   ↓
6. Workers: ArXiv ID 抽出
   ↓
7. Workers → GET http://export.arxiv.org/api/query?id_list=xxx
   ↓
8. ArXiv API → Atom XML
   ↓
9. Workers: XML パース → ArxivPaper 型に変換
   ↓
10. Workers → PATCH https://api.notion.com/v1/pages/{page_id}
    Body: { properties: { Title, Authors, Summary, ... } }
    ↓
11. Notion → { id: page_id, ... }
    ↓
12. Workers → JSON { success: true, ... }
```

### 4.3 エラーフロー

```
エラー発生
  ↓
Middleware: errorHandler でキャッチ
  ↓
エラーの種類を判定
  ├─ NotionApiError → 500 or 502
  ├─ ArxivApiError → 502
  ├─ ValidationError → 400
  └─ その他 → 500
  ↓
ログ出力（console.error）
  ↓
JSON エラーレスポンス返却
```

---

## 5. Cloudflare KV 設計

### 5.1 キー設計

#### 5.1.1 OAuth State

**キー**: `state:{state}`

**値**:

```json
{
  "parentPageId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "createdAt": 1700000000000
}
```

**TTL**: 600 秒（10 分）

**用途**: CSRF 対策と親ページ ID の一時保存

#### 5.1.2 ワークスペース設定

**キー**: `notion:workspace:{workspaceId}:config`

**値**:

```json
{
  "accessToken": "secret_xxxxxxxxxxxxxxxxxxxx",
  "databaseId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "workspaceName": "My Workspace",
  "botId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "createdAt": "2025-11-22T12:34:56.789Z"
}
```

**TTL**: なし（永続化）

**用途**: ワークスペースごとの Notion 連携設定

### 5.2 KV 操作パターン

#### 5.2.1 書き込み

```typescript
await env.KV.put(
  key,
  JSON.stringify(value),
  { expirationTtl: 600 } // オプション
);
```

#### 5.2.2 読み取り

```typescript
const raw = await env.KV.get(key);
const value = raw ? JSON.parse(raw) : null;
```

#### 5.2.3 削除

```typescript
await env.KV.delete(key);
```

### 5.3 KV パフォーマンス考慮事項

- **読み取りレイテンシ**: 通常 10ms 以内
- **書き込みレイテンシ**: 通常 100ms 以内
- **整合性**: 最終的整合性（Eventual Consistency）
- **リスト操作**: 使用しない（キーを直接指定）

---

## 6. セキュリティアーキテクチャ

### 6.1 OAuth セキュリティ

#### 6.1.1 CSRF 対策

- `state` パラメータの使用
- ランダムな state 値の生成（`crypto.randomUUID()`）
- State の有効期限（10 分）
- State の一度限りの使用（検証後に削除）

#### 6.1.2 トークン管理

- アクセストークンは KV に平文保存（Workers 環境の信頼性に依存）
- トークンは HTTPS 通信でのみ送信
- トークンはクライアントに露出させない
- トークンの有効期限は Notion 側で管理

### 6.2 入力検証

#### 6.2.1 検証レイヤー

```
Request
  ↓
1. 型検証（TypeScript）
  ↓
2. フォーマット検証（正規表現）
  ↓
3. ビジネスロジック検証（存在確認など）
  ↓
Processing
```

#### 6.2.2 検証項目

- **parent_page_id**: UUID 形式
- **workspace_id**: UUID 形式
- **page_id**: UUID 形式
- **link**: ArXiv URL 形式（正規表現）
- **state**: 英数字のみ

### 6.3 HTTPS 強制

Cloudflare Workers は自動的に HTTPS を強制するため、追加設定は不要。

### 6.4 CORS 設定

現時点では CORS は不要（ブラウザから直接 API を呼ばない）。
将来的にフロントエンドを追加する場合は、以下のミドルウェアを追加:

```typescript
import { cors } from "hono/cors";

app.use(
  "/api/*",
  cors({
    origin: ["https://your-frontend.com"],
    allowMethods: ["GET", "POST"],
    allowHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);
```

---

## 7. エラーハンドリング戦略

### 7.1 エラー階層

```
Error (標準)
  ↓
AppError (アプリケーション基底エラー)
  ├─ ValidationError (400)
  ├─ UnauthorizedError (401)
  ├─ ForbiddenError (403)
  ├─ NotFoundError (404)
  ├─ NotionApiError (500/502)
  ├─ ArxivApiError (502)
  └─ InternalError (500)
```

### 7.2 エラーハンドリングミドルウェア

```typescript
import { Hono } from "hono";
import type { Bindings } from "../types/bindings";
import { AppError } from "../utils/errors";

export function errorHandler() {
  return async (c: Context<{ Bindings: Bindings }>, next: Next) => {
    try {
      await next();
    } catch (error) {
      console.error("Error occurred:", {
        timestamp: new Date().toISOString(),
        path: c.req.path,
        method: c.req.method,
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
      });

      if (error instanceof AppError) {
        return c.json(
          {
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          },
          error.statusCode
        );
      }

      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred",
          },
        },
        500
      );
    }
  };
}
```

### 7.3 リトライ戦略

#### 7.3.1 リトライ対象

- ArXiv API の 503 エラー
- Notion API の 429 エラー（レート制限）
- ネットワークタイムアウト

#### 7.3.2 リトライ実装

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // リトライ不可能なエラーは即座に throw
      if (!isRetryableError(error)) {
        throw error;
      }

      // 最後のリトライの場合は待機しない
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

function isRetryableError(error: any): boolean {
  if (error instanceof ArxivApiError) {
    return error.statusCode === 503;
  }
  if (error instanceof NotionApiError) {
    return error.statusCode === 429;
  }
  return false;
}
```

---

## 8. パフォーマンス最適化

### 8.1 レスポンスタイム最適化

#### 8.1.1 並列処理

可能な限り並列処理を活用:

```typescript
// 悪い例
const config = await getConfig(workspaceId);
const paper = await fetchPaper(arxivId);
await updatePage(pageId, paper);

// 良い例（config 取得と paper 取得を並列化）
const [config, paper] = await Promise.all([
  getConfig(workspaceId),
  fetchPaper(arxivId),
]);
await updatePage(pageId, paper);
```

#### 8.1.2 KV キャッシング

頻繁にアクセスされるデータは KV にキャッシュ:

```typescript
// ArXiv データのキャッシング（オプション）
const cacheKey = `arxiv:paper:${arxivId}`;
const cached = await env.KV.get(cacheKey);

if (cached) {
  return JSON.parse(cached);
}

const paper = await fetchPaperFromApi(arxivId);
await env.KV.put(cacheKey, JSON.stringify(paper), {
  expirationTtl: 86400, // 24時間
});

return paper;
```

### 8.2 メモリ使用量最適化

- 大きな XML レスポンスはストリーミング処理（必要に応じて）
- 不要なデータは早期に破棄
- Workers の 128MB メモリ制限を意識

### 8.3 CPU 時間最適化

- 正規表現は事前にコンパイル
- JSON パースは最小限に
- 不要なループを避ける

---

## 9. モニタリングとロギング

### 9.1 ログレベル

| レベル  | 用途                 | 出力先        |
| ------- | -------------------- | ------------- |
| `error` | エラー発生時         | console.error |
| `warn`  | 警告（リトライなど） | console.warn  |
| `info`  | 重要なイベント       | console.log   |
| `debug` | デバッグ情報         | console.log   |

### 9.2 ログフォーマット

```typescript
interface LogEntry {
  timestamp: string; // ISO 8601
  level: "error" | "warn" | "info" | "debug";
  message: string;
  context?: {
    endpoint?: string;
    workspaceId?: string;
    pageId?: string;
    arxivId?: string;
    error?: {
      name: string;
      message: string;
      stack?: string;
    };
  };
}
```

### 9.3 Cloudflare Analytics

Cloudflare Workers の標準メトリクス:

- リクエスト数
- エラー率
- レスポンスタイム（P50, P95, P99）
- CPU 時間
- KV 操作回数

---

## 10. デプロイメント

### 10.1 環境構成

| 環境        | 用途           | Workers URL                                |
| ----------- | -------------- | ------------------------------------------ |
| Development | ローカル開発   | `http://localhost:8787`                    |
| Preview     | プレビュー環境 | `https://arxiv-webhook.{user}.workers.dev` |
| Production  | 本番環境       | `https://arxiv-webhook.workers.dev`        |

### 10.2 デプロイフロー

```
1. コード変更
   ↓
2. ローカルテスト（wrangler dev）
   ↓
3. プレビューデプロイ（wrangler deploy --env preview）
   ↓
4. 動作確認
   ↓
5. 本番デプロイ（wrangler deploy）
```

### 10.3 ロールバック戦略

Cloudflare Workers は自動的にバージョン管理されるため、
ダッシュボードから以前のバージョンにロールバック可能。

---

## 11. 将来の拡張性

### 11.1 短期的な拡張

- **エラー通知**: Sentry などのエラートラッキングサービス統合
- **ログ集約**: Cloudflare Logpush による外部ログサービス連携
- **メトリクス**: カスタムメトリクスの追加

### 11.2 中期的な拡張

- **複数 DB 管理**: 1 ワークスペースで複数の ArXiv DB を管理
- **Notion Webhooks API**: Automations から公式 Webhooks API への移行
- **バッチ同期**: 定期的な全ページ同期機能

### 11.3 長期的な拡張

- **フロントエンド**: 管理画面の追加（Next.js など）
- **マルチテナント**: 複数ユーザーの管理
- **高度な検索**: ArXiv 論文の検索・フィルタリング機能
- **AI 統合**: 論文要約の自動生成

---

## 12. 参考資料

### 12.1 公式ドキュメント

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare KV Documentation](https://developers.cloudflare.com/kv/)
- [Hono Documentation](https://hono.dev/)
- [Notion API Documentation](https://developers.notion.com/)
- [Notion Refresh Token API](https://developers.notion.com/reference/refresh-a-token)
- [@notionhq/client SDK](https://github.com/makenotion/notion-sdk-js)
- [ArXiv API Documentation](https://info.arxiv.org/help/api/index.html)

### 12.2 関連ドキュメント

- [requirements.md](./requirements.md) - 要件定義書
- [sequences.md](./sequences.md) - シーケンス図
- [types.md](./types.md) - TypeScript 型定義仕様

---

## 13. 変更履歴

| バージョン | 日付       | 変更内容                                                                          | 担当者 |
| ---------- | ---------- | --------------------------------------------------------------------------------- | ------ |
| 2.0.0      | 2025-11-23 | D1 導入、Cron Triggers 追加、Token Refresh Service 追加、Integration Service 追加 | -      |
| 1.0.0      | 2025-11-22 | 初版作成                                                                          | -      |

---

**このドキュメントは、ArXiv Notion 同期システムの実装における技術的な設計指針を提供する。**
