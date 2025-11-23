# Notion × ArXiv 自動同期システム TypeScript 型定義仕様

## ドキュメント情報

- **バージョン**: 2.0.0
- **最終更新日**: 2025-11-23
- **対象システム**: ArXiv Webhook Workers
- **関連ドキュメント**: [requirements.md](./requirements.md), [architecture.md](./architecture.md)
- **主な変更**: D1 型定義追加、refresh_token 対応、duplicated_template_id 追加

---

## 目次

1. [Cloudflare Workers 関連型](#1-cloudflare-workers-関連型)
   - 1.1 Bindings
   - 1.2 KV データ構造（簡素化）
   - 1.3 D1 データ構造
2. [Notion API 関連型](#2-notion-api-関連型)
3. [ArXiv API 関連型](#3-arxiv-api-関連型)
4. [Webhook 関連型](#4-webhook-関連型)
5. [サービス層インターフェース](#5-サービス層インターフェース)
   - 5.1 Notion Auth Service
   - 5.2 Notion Database Service
   - 5.3 ArXiv Service
   - 5.4 Integration Service（旧 Workspace Config Service）
   - 5.5 Token Refresh Service
6. [ユーティリティ型](#6-ユーティリティ型)
7. [エラー型](#7-エラー型)
8. [Cron Triggers 関連型](#8-cron-triggers-関連型)

---

## 1. Cloudflare Workers 関連型

### 1.1 Bindings

**ファイル**: `src/types/bindings.ts`

```typescript
/**
 * Cloudflare Workers の環境変数とバインディング
 */
export interface Bindings {
  // D1 Database
  DB: D1Database;

  // KV Namespace
  KV: KVNamespace;

  // 環境変数
  NOTION_CLIENT_ID: string;
  NOTION_CLIENT_SECRET: string;
  WORKER_URL: string;

  // オプション環境変数
  LOG_LEVEL?: "debug" | "info" | "warn" | "error";
  ARXIV_API_TIMEOUT?: string; // ミリ秒（文字列）
  NOTION_API_TIMEOUT?: string; // ミリ秒（文字列）
}

/**
 * Hono コンテキストの型定義
 */
export type HonoEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

/**
 * Hono Variables（リクエストスコープの変数）
 */
export interface Variables {
  requestId?: string;
  startTime?: number;
}
```

### 1.2 KV データ構造（簡素化）

**ファイル**: `src/types/kv.ts`

```typescript
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
```

**注**: ワークスペース設定は D1 に移行したため、KV は OAuth state のみに使用。

### 1.3 D1 データ構造

**ファイル**: `src/types/d1.ts`

```typescript
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
  duplicated_template_id: string | null;
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
 * Integration 作成用の入力型
 */
export interface CreateIntegrationInput {
  bot_id: string;
  workspace_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at?: string | null;
  database_id?: string | null;
  duplicated_template_id?: string | null;
}

/**
 * Integration 更新用の入力型
 */
export interface UpdateIntegrationInput {
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string | null;
  database_id?: string | null;
}
```

---

## 2. Notion API 関連型

### 2.1 OAuth 関連型

**ファイル**: `src/types/notion.ts`

```typescript
/**
 * Notion OAuth トークンレスポンス
 * @see https://developers.notion.com/docs/authorization#step-4-notion-responds-with-an-access_token--refresh_token-and-additional-information
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
 * OAuth 認可 URL パラメータ
 */
export interface NotionOAuthParams {
  client_id: string;
  redirect_uri: string;
  response_type: "code";
  owner: "user";
  state: string;
}
```

### 2.2 データベース関連型

**ファイル**: `src/types/notion.ts`

```typescript
import type {
  CreateDatabaseParameters,
  DatabaseObjectResponse,
  PageObjectResponse,
  UpdatePageParameters,
} from "@notionhq/client/build/src/api-endpoints";

/**
 * ArXiv データベースのプロパティスキーマ
 */
export interface ArxivDatabaseSchema {
  Title: {
    title: Record<string, never>;
  };
  Authors: {
    rich_text: Record<string, never>;
  };
  Summary: {
    rich_text: Record<string, never>;
  };
  Link: {
    url: Record<string, never>;
  };
  "Publication Year": {
    number: {
      format: "number";
    };
  };
}

/**
 * ArXiv データベース作成パラメータ
 */
export interface CreateArxivDatabaseParams {
  parentPageId: string;
  title?: string; // デフォルト: "ArXiv Papers"
}

/**
 * Notion ページプロパティ（ArXiv 用）
 */
export interface NotionPageProperties {
  Title: {
    title: Array<{
      type: "text";
      text: {
        content: string;
      };
    }>;
  };
  Authors: {
    rich_text: Array<{
      type: "text";
      text: {
        content: string;
      };
    }>;
  };
  Summary: {
    rich_text: Array<{
      type: "text";
      text: {
        content: string;
      };
    }>;
  };
  Link: {
    url: string;
  };
  "Publication Year": {
    number: number;
  };
}

/**
 * Notion SDK の型を再エクスポート（便宜上）
 */
export type {
  CreateDatabaseParameters,
  DatabaseObjectResponse,
  PageObjectResponse,
  UpdatePageParameters,
};
```

### 2.3 Rich Text ヘルパー型

**ファイル**: `src/types/notion.ts`

```typescript
/**
 * Notion Rich Text アイテム
 */
export interface RichTextItem {
  type: "text";
  text: {
    content: string;
    link?: {
      url: string;
    } | null;
  };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: string;
  };
  plain_text?: string;
  href?: string | null;
}

/**
 * Rich Text 配列（2000文字制限対応）
 */
export type RichTextArray = RichTextItem[];

/**
 * Rich Text 分割オプション
 */
export interface SplitRichTextOptions {
  maxLength?: number; // デフォルト: 2000
  preserveWords?: boolean; // 単語の途中で切らない
}
```

---

## 3. ArXiv API 関連型

### 3.1 ArXiv データ型

**ファイル**: `src/types/arxiv.ts`

```typescript
/**
 * ArXiv 論文データ（内部表現）
 */
export interface ArxivPaper {
  title: string;
  authors: string[]; // 著者名の配列
  summary: string;
  link: string; // ArXiv URL
  publishedYear: number; // 4桁の年
}

/**
 * ArXiv API レスポンス（Atom XML パース後）
 */
export interface ArxivApiResponse {
  feed: {
    entry?: ArxivEntry | ArxivEntry[];
    totalResults?: number;
    startIndex?: number;
    itemsPerPage?: number;
  };
}

/**
 * ArXiv Entry（単一論文）
 */
export interface ArxivEntry {
  id: string; // URL形式: http://arxiv.org/abs/2301.12345v1
  updated: string; // ISO 8601
  published: string; // ISO 8601
  title: string;
  summary: string;
  author: ArxivAuthor | ArxivAuthor[];
  link?: ArxivLink | ArxivLink[];
  "arxiv:primary_category"?: {
    "@_term": string;
    "@_scheme": string;
  };
  category?: ArxivCategory | ArxivCategory[];
}

/**
 * ArXiv 著者
 */
export interface ArxivAuthor {
  name: string;
  "arxiv:affiliation"?: string;
}

/**
 * ArXiv リンク
 */
export interface ArxivLink {
  "@_href": string;
  "@_rel"?: string;
  "@_type"?: string;
  "@_title"?: string;
}

/**
 * ArXiv カテゴリ
 */
export interface ArxivCategory {
  "@_term": string;
  "@_scheme": string;
}

/**
 * ArXiv ID 抽出結果
 */
export interface ArxivIdExtractionResult {
  id: string; // 例: "2301.12345"
  version?: string; // 例: "v1"
  url: string; // 元の URL
}
```

### 3.2 ArXiv URL パターン

**ファイル**: `src/types/arxiv.ts`

```typescript
/**
 * ArXiv URL パターン（正規表現）
 */
export const ARXIV_URL_PATTERNS = {
  /**
   * 標準パターン: https://arxiv.org/abs/2301.12345
   */
  STANDARD: /arxiv\.org\/abs\/(\d{4}\.\d{4,5})(v\d+)?/,

  /**
   * PDF パターン: https://arxiv.org/pdf/2301.12345.pdf
   */
  PDF: /arxiv\.org\/pdf\/(\d{4}\.\d{4,5})(v\d+)?\.pdf/,

  /**
   * 統合パターン（両方に対応）
   */
  COMBINED: /arxiv\.org\/(abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?(\.pdf)?/,
} as const;

/**
 * ArXiv ID フォーマット
 */
export const ARXIV_ID_FORMAT = /^\d{4}\.\d{4,5}$/;
```

---

## 4. Webhook 関連型

### 4.1 Webhook Payload

**ファイル**: `src/types/webhook.ts`

```typescript
/**
 * Notion Automation からの Webhook Payload
 */
export interface NotionAutomationPayload {
  workspace_id: string;
  page_id: string;
  link: string; // ArXiv URL
}

/**
 * Webhook イベント型
 */
export type WebhookEventType = "page.updated" | "page.created";

/**
 * Webhook イベント（拡張版）
 */
export interface WebhookEvent {
  type: WebhookEventType;
  workspace_id: string;
  page_id: string;
  properties?: {
    link?: string;
    [key: string]: any;
  };
  timestamp?: string; // ISO 8601
}

/**
 * Webhook レスポンス
 */
export interface WebhookResponse {
  success: boolean;
  page_id: string;
  updated_at: string; // ISO 8601
  error?: {
    code: string;
    message: string;
  };
}
```

### 4.2 Webhook バリデーション

**ファイル**: `src/types/webhook.ts`

```typescript
/**
 * Webhook Payload バリデーション結果
 */
export interface WebhookValidationResult {
  valid: boolean;
  errors: WebhookValidationError[];
}

/**
 * Webhook バリデーションエラー
 */
export interface WebhookValidationError {
  field: string;
  message: string;
  code: "MISSING_FIELD" | "INVALID_FORMAT" | "INVALID_VALUE";
}

/**
 * Webhook バリデーションルール
 */
export interface WebhookValidationRules {
  workspace_id: {
    required: true;
    format: "uuid";
  };
  page_id: {
    required: true;
    format: "uuid";
  };
  link: {
    required: true;
    format: "arxiv_url";
  };
}
```

---

## 5. サービス層インターフェース

### 5.1 Notion Auth Service

**ファイル**: `src/types/services.ts`

```typescript
import type { Bindings } from "./bindings";
import type { NotionOAuthTokenResponse, OAuthState } from "./notion";

/**
 * Notion 認証サービスインターフェース
 */
export interface INotionAuthService {
  /**
   * OAuth 認可 URL を生成
   */
  generateAuthUrl(): Promise<string>;

  /**
   * State を検証
   */
  verifyState(state: string): Promise<OAuthState>;

  /**
   * 認可コードをアクセストークンに交換
   */
  exchangeCodeForToken(code: string): Promise<NotionOAuthTokenResponse>;

  /**
   * トークンをリフレッシュ
   */
  refreshAccessToken(refreshToken: string): Promise<NotionRefreshTokenResponse>;
}

/**
 * Notion Auth Service 実装クラスのコンストラクタ引数
 */
export interface NotionAuthServiceOptions {
  env: Bindings;
  stateExpirationSeconds?: number; // デフォルト: 600
}
```

### 5.2 Notion Database Service

**ファイル**: `src/types/services.ts`

```typescript
import type { Bindings } from "./bindings";
import type { DatabaseObjectResponse, PageObjectResponse } from "./notion";
import type { ArxivPaper } from "./arxiv";

/**
 * Notion データベースサービスインターフェース
 */
export interface INotionDatabaseService {
  /**
   * ArXiv データベースを作成
   */
  createArxivDatabase(
    accessToken: string,
    parentPageId: string,
    title?: string
  ): Promise<DatabaseObjectResponse>;

  /**
   * ページを更新
   */
  updatePage(
    accessToken: string,
    pageId: string,
    paper: ArxivPaper
  ): Promise<PageObjectResponse>;
}

/**
 * Notion Database Service 実装クラスのコンストラクタ引数
 */
export interface NotionDatabaseServiceOptions {
  env: Bindings;
  apiTimeout?: number; // ミリ秒
}
```

### 5.3 ArXiv Service

**ファイル**: `src/types/services.ts`

```typescript
import type { ArxivPaper, ArxivIdExtractionResult } from "./arxiv";

/**
 * ArXiv サービスインターフェース
 */
export interface IArxivService {
  /**
   * URL から論文データを取得
   */
  fetchPaperByUrl(url: string): Promise<ArxivPaper>;

  /**
   * ArXiv ID から論文データを取得
   */
  fetchPaperById(arxivId: string): Promise<ArxivPaper>;

  /**
   * URL から ArXiv ID を抽出
   */
  extractArxivId(url: string): ArxivIdExtractionResult | null;
}

/**
 * ArXiv Service 実装クラスのコンストラクタ引数
 */
export interface ArxivServiceOptions {
  apiTimeout?: number; // ミリ秒（デフォルト: 10000）
  maxRetries?: number; // 最大リトライ回数（デフォルト: 3）
  baseDelay?: number; // リトライ間隔（ミリ秒、デフォルト: 1000）
}
```

### 5.4 Workspace Config Service

**ファイル**: `src/types/services.ts`

```typescript
import type { Bindings } from "./bindings";
import type { WorkspaceConfig } from "./kv";

/**
 * Integration 管理サービスインターフェース（旧 WorkspaceConfigService）
 */
export interface IIntegrationService {
  /**
   * Integration を作成
   */
  createIntegration(input: CreateIntegrationInput): Promise<void>;

  /**
   * Integration を取得（workspace_id で検索）
   */
  getIntegrationByWorkspaceId(workspaceId: string): Promise<Integration | null>;

  /**
   * Integration を取得（bot_id で検索）
   */
  getIntegrationByBotId(botId: string): Promise<Integration | null>;

  /**
   * Integration を更新
   */
  updateIntegration(
    botId: string,
    input: UpdateIntegrationInput
  ): Promise<void>;

  /**
   * Integration を削除
   */
  deleteIntegration(botId: string): Promise<void>;

  /**
   * 有効期限が近い Integration を取得
   */
  getExpiringIntegrations(hoursUntilExpiry: number): Promise<Integration[]>;
}

/**
 * Integration Service 実装クラスのコンストラクタ引数
 */
export interface IntegrationServiceOptions {
  env: Bindings;
}
```

### 5.5 Token Refresh Service

**ファイル**: `src/types/services.ts`

```typescript
import type { Bindings } from "./bindings";
import type { Integration } from "./d1";

/**
 * トークンリフレッシュサービスインターフェース
 */
export interface ITokenRefreshService {
  /**
   * 特定の Integration のトークンをリフレッシュ
   */
  refreshToken(botId: string): Promise<void>;

  /**
   * 有効期限が近い全トークンをリフレッシュ
   */
  refreshExpiringTokens(): Promise<RefreshResult>;

  /**
   * トークンの有効期限をチェック
   */
  isTokenExpired(integration: Integration): boolean;

  /**
   * トークンの有効期限が近いかチェック
   */
  isTokenExpiringSoon(
    integration: Integration,
    hoursThreshold: number
  ): boolean;
}

/**
 * リフレッシュ結果
 */
export interface RefreshResult {
  total: number; // 対象トークン数
  success: number; // 成功数
  failed: number; // 失敗数
  errors: RefreshError[]; // エラー詳細
}

/**
 * リフレッシュエラー
 */
export interface RefreshError {
  botId: string;
  workspaceId: string;
  error: string;
  timestamp: string; // ISO 8601
}

/**
 * Token Refresh Service 実装クラスのコンストラクタ引数
 */
export interface TokenRefreshServiceOptions {
  env: Bindings;
  hoursThreshold?: number; // デフォルト: 24
}
```

---

## 6. ユーティリティ型

### 6.1 バリデーション型

**ファイル**: `src/types/validation.ts`

```typescript
/**
 * バリデーション結果
 */
export interface ValidationResult<T = any> {
  valid: boolean;
  data?: T;
  errors: ValidationError[];
}

/**
 * バリデーションエラー
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * UUID バリデーション
 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * バリデータ関数型
 */
export type Validator<T> = (value: unknown) => ValidationResult<T>;

/**
 * バリデーションスキーマ
 */
export interface ValidationSchema<T> {
  [K in keyof T]: {
    required?: boolean;
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    pattern?: RegExp;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    custom?: (value: any) => boolean;
    message?: string;
  };
}
```

### 6.2 ロギング型

**ファイル**: `src/types/logger.ts`

```typescript
/**
 * ログレベル
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * ログエントリ
 */
export interface LogEntry {
  timestamp: string; // ISO 8601
  level: LogLevel;
  message: string;
  context?: LogContext;
}

/**
 * ログコンテキスト
 */
export interface LogContext {
  endpoint?: string;
  method?: string;
  workspaceId?: string;
  pageId?: string;
  arxivId?: string;
  duration?: number; // ミリ秒
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  [key: string]: any;
}

/**
 * Logger インターフェース
 */
export interface ILogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
```

### 6.3 リトライ型

**ファイル**: `src/types/retry.ts`

```typescript
/**
 * リトライ設定
 */
export interface RetryOptions {
  maxRetries?: number; // デフォルト: 3
  baseDelay?: number; // ミリ秒（デフォルト: 1000）
  maxDelay?: number; // ミリ秒（デフォルト: 10000）
  backoffMultiplier?: number; // デフォルト: 2
  retryableErrors?: string[]; // リトライ可能なエラー名
  retryableStatusCodes?: number[]; // リトライ可能な HTTP ステータスコード
}

/**
 * リトライ結果
 */
export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  totalDuration: number; // ミリ秒
}

/**
 * リトライ可能判定関数
 */
export type RetryablePredicate = (error: Error) => boolean;
```

---

## 7. エラー型

### 7.1 カスタムエラークラス

**ファイル**: `src/types/errors.ts`

```typescript
/**
 * アプリケーション基底エラー
 */
export abstract class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly details?: Record<string, any>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

/**
 * バリデーションエラー (400)
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

/**
 * 認証エラー (401)
 */
export class UnauthorizedError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, "UNAUTHORIZED", 401, details);
  }
}

/**
 * 権限エラー (403)
 */
export class ForbiddenError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, "FORBIDDEN", 403, details);
  }
}

/**
 * リソース未検出エラー (404)
 */
export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, "NOT_FOUND", 404, details);
  }
}

/**
 * Notion API エラー (500/502)
 */
export class NotionApiError extends AppError {
  constructor(
    message: string,
    public readonly originalError?: any,
    statusCode: number = 500
  ) {
    super(message, "NOTION_API_ERROR", statusCode, {
      originalError: originalError?.message,
    });
  }
}

/**
 * ArXiv API エラー (502)
 */
export class ArxivApiError extends AppError {
  constructor(message: string, public readonly originalError?: any) {
    super(message, "ARXIV_API_ERROR", 502, {
      originalError: originalError?.message,
    });
  }
}

/**
 * 内部エラー (500)
 */
export class InternalError extends AppError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, "INTERNAL_ERROR", 500, details);
  }
}

/**
 * レート制限エラー (429)
 */
export class RateLimitError extends AppError {
  constructor(
    message: string,
    public readonly retryAfter?: number // 秒
  ) {
    super(message, "RATE_LIMIT_EXCEEDED", 429, { retryAfter });
  }
}
```

### 7.2 エラーハンドラー型

**ファイル**: `src/types/errors.ts`

```typescript
import type { Context } from "hono";
import type { HonoEnv } from "./bindings";

/**
 * エラーハンドラー関数型
 */
export type ErrorHandler = (
  error: Error,
  c: Context<HonoEnv>
) => Response | Promise<Response>;

/**
 * エラーレスポンス
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}
```

---

## 8. 型ガード

### 8.1 型ガード関数

**ファイル**: `src/types/guards.ts`

```typescript
import type { NotionAutomationPayload } from "./webhook";
import type { ArxivPaper } from "./arxiv";
import type { WorkspaceConfig } from "./kv";

/**
 * Notion Automation Payload の型ガード
 */
export function isNotionAutomationPayload(
  value: unknown
): value is NotionAutomationPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.workspace_id === "string" &&
    typeof payload.page_id === "string" &&
    typeof payload.link === "string"
  );
}

/**
 * ArXiv Paper の型ガード
 */
export function isArxivPaper(value: unknown): value is ArxivPaper {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const paper = value as Record<string, unknown>;

  return (
    typeof paper.title === "string" &&
    Array.isArray(paper.authors) &&
    paper.authors.every((a) => typeof a === "string") &&
    typeof paper.summary === "string" &&
    typeof paper.link === "string" &&
    typeof paper.publishedYear === "number"
  );
}

/**
 * Workspace Config の型ガード
 */
export function isWorkspaceConfig(value: unknown): value is WorkspaceConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const config = value as Record<string, unknown>;

  return (
    typeof config.accessToken === "string" &&
    typeof config.databaseId === "string" &&
    typeof config.workspaceName === "string" &&
    typeof config.botId === "string" &&
    typeof config.createdAt === "string"
  );
}

/**
 * UUID の型ガード
 */
export function isUUID(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

/**
 * ArXiv URL の型ガード
 */
export function isArxivUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  return /arxiv\.org\/(abs|pdf)\/\d{4}\.\d{4,5}/.test(value);
}
```

---

## 9. 型ユーティリティ

### 9.1 ヘルパー型

**ファイル**: `src/types/utils.ts`

```typescript
/**
 * オプショナルプロパティを必須にする
 */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * 必須プロパティをオプショナルにする
 */
export type PartialKeys<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;

/**
 * 読み取り専用の深いバージョン
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * Nullable 型
 */
export type Nullable<T> = T | null;

/**
 * Maybe 型
 */
export type Maybe<T> = T | null | undefined;

/**
 * Promise の解決型を取得
 */
export type Awaited<T> = T extends Promise<infer U> ? U : T;

/**
 * 関数の戻り値の型を取得
 */
export type ReturnTypeAsync<T extends (...args: any) => any> = Awaited<
  ReturnType<T>
>;
```

---

## 8. Cron Triggers 関連型

### 8.1 Scheduled Event

**ファイル**: `src/types/scheduled.ts`

```typescript
import type { Bindings } from "./bindings";

/**
 * Cloudflare Workers Scheduled Event
 * @see https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/
 */
export interface ScheduledEvent {
  type: "scheduled";
  scheduledTime: number; // Unix timestamp (ms)
  cron: string; // Cron expression
}

/**
 * Scheduled Handler の型定義
 */
export interface ScheduledHandler {
  scheduled(
    event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<void> | void;
}

/**
 * Cron Job の実行結果
 */
export interface CronJobResult {
  jobName: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  duration: number; // ミリ秒
  success: boolean;
  message?: string;
  error?: string;
}
```

### 8.2 Token Refresh Cron

**ファイル**: `src/scheduled.ts`

```typescript
import type {
  ScheduledEvent,
  ScheduledHandler,
  CronJobResult,
} from "./types/scheduled";
import type { Bindings } from "./types/bindings";
import { TokenRefreshService } from "./services/tokenRefreshService";

/**
 * Cron Triggers のエントリーポイント
 */
export const scheduled: ScheduledHandler["scheduled"] = async (
  event: ScheduledEvent,
  env: Bindings,
  ctx: ExecutionContext
) => {
  const startTime = new Date().toISOString();

  try {
    console.log(`[Cron] Token refresh started at ${startTime}`);
    console.log(
      `[Cron] Scheduled time: ${new Date(event.scheduledTime).toISOString()}`
    );
    console.log(`[Cron] Cron expression: ${event.cron}`);

    const refreshService = new TokenRefreshService({ env });
    const result = await refreshService.refreshExpiringTokens();

    const endTime = new Date().toISOString();
    const duration = Date.now() - new Date(startTime).getTime();

    const jobResult: CronJobResult = {
      jobName: "token-refresh",
      startTime,
      endTime,
      duration,
      success: result.failed === 0,
      message: `Total: ${result.total}, Success: ${result.success}, Failed: ${result.failed}`,
    };

    console.log(`[Cron] Token refresh completed:`, jobResult);

    if (result.failed > 0) {
      console.error(`[Cron] Refresh errors:`, result.errors);
    }
  } catch (error) {
    const endTime = new Date().toISOString();
    const duration = Date.now() - new Date(startTime).getTime();

    const jobResult: CronJobResult = {
      jobName: "token-refresh",
      startTime,
      endTime,
      duration,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };

    console.error(`[Cron] Token refresh failed:`, jobResult);
    throw error;
  }
};
```

---

## 9. 変更履歴

| バージョン | 日付       | 変更内容                                                                   |
| ---------- | ---------- | -------------------------------------------------------------------------- |
| 2.0.0      | 2025-11-23 | D1 型定義追加、refresh_token 対応、Token Refresh Service 追加、Cron 型追加 |
| 1.0.0      | 2025-11-22 | 初版作成                                                                   |

---

## 10. 実装例

### 10.1 型の使用例

**ファイル**: `src/services/notionDatabaseService.ts`

```typescript
import { Client } from "@notionhq/client";
import type { Bindings } from "../types/bindings";
import type {
  INotionDatabaseService,
  NotionDatabaseServiceOptions,
} from "../types/services";
import type {
  DatabaseObjectResponse,
  PageObjectResponse,
  NotionPageProperties,
} from "../types/notion";
import type { ArxivPaper } from "../types/arxiv";
import { NotionApiError } from "../types/errors";

export class NotionDatabaseService implements INotionDatabaseService {
  private readonly env: Bindings;
  private readonly apiTimeout: number;

  constructor(options: NotionDatabaseServiceOptions) {
    this.env = options.env;
    this.apiTimeout = options.apiTimeout || 10000;
  }

  async createArxivDatabase(
    accessToken: string,
    parentPageId: string,
    title: string = "ArXiv Papers"
  ): Promise<DatabaseObjectResponse> {
    const client = new Client({
      auth: accessToken,
      timeoutMs: this.apiTimeout,
    });

    try {
      return await client.databases.create({
        parent: {
          type: "page_id",
          page_id: parentPageId,
        },
        title: [
          {
            type: "text",
            text: { content: title },
          },
        ],
        properties: {
          Title: { title: {} },
          Authors: { rich_text: {} },
          Summary: { rich_text: {} },
          Link: { url: {} },
          "Publication Year": { number: { format: "number" } },
        },
      });
    } catch (error) {
      throw new NotionApiError("Failed to create database", error);
    }
  }

  async updatePage(
    accessToken: string,
    pageId: string,
    paper: ArxivPaper
  ): Promise<PageObjectResponse> {
    const client = new Client({
      auth: accessToken,
      timeoutMs: this.apiTimeout,
    });

    const properties: NotionPageProperties = {
      Title: {
        title: [
          {
            type: "text",
            text: { content: paper.title.slice(0, 2000) },
          },
        ],
      },
      Authors: {
        rich_text: [
          {
            type: "text",
            text: { content: paper.authors.join(", ").slice(0, 2000) },
          },
        ],
      },
      Summary: {
        rich_text: this.splitRichText(paper.summary),
      },
      Link: {
        url: paper.link,
      },
      "Publication Year": {
        number: paper.publishedYear,
      },
    };

    try {
      return await client.pages.update({
        page_id: pageId,
        properties,
      });
    } catch (error) {
      throw new NotionApiError("Failed to update page", error);
    }
  }

  private splitRichText(text: string, maxLength: number = 2000) {
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) {
      chunks.push({
        type: "text" as const,
        text: { content: text.slice(i, i + maxLength) },
      });
    }
    return chunks;
  }
}
```

---

## 11. 参考資料

### 11.1 公式ドキュメント

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [Notion API Types](https://github.com/makenotion/notion-sdk-js/tree/main/src/api-endpoints.ts)
- [Cloudflare Workers Types](https://github.com/cloudflare/workers-types)
- [Hono Types](https://hono.dev/docs/api/hono)

### 11.2 関連ドキュメント

- [requirements.md](./requirements.md) - 要件定義書
- [architecture.md](./architecture.md) - アーキテクチャ設計書
- [sequences.md](./sequences.md) - シーケンス図

---

## 12. 変更履歴

| バージョン | 日付       | 変更内容 | 担当者 |
| ---------- | ---------- | -------- | ------ |
| 1.0.0      | 2025-11-22 | 初版作成 | -      |

---

**このドキュメントは、ArXiv Notion 同期システムの型安全な実装を支援するために作成された。すべての型定義は TypeScript の厳格モードで動作することを前提としている。**
