/**
 * カスタムエラーの基底クラス
 */
export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = "INTERNAL_ERROR"
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * バリデーションエラー
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, "VALIDATION_ERROR");
  }
}

/**
 * 認証エラー
 */
export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication failed") {
    super(message, 401, "AUTHENTICATION_ERROR");
  }
}

/**
 * 認可エラー
 */
export class AuthorizationError extends AppError {
  constructor(message: string = "Forbidden") {
    super(message, 403, "AUTHORIZATION_ERROR");
  }
}

/**
 * リソースが見つからない
 */
export class NotFoundError extends AppError {
  constructor(message: string = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

/**
 * Notion API エラー
 */
export class NotionApiError extends AppError {
  constructor(message: string, statusCode: number = 500) {
    super(message, statusCode, "NOTION_API_ERROR");
  }
}

/**
 * 論文メタデータの取得に失敗した
 */
export class PaperFetchError extends AppError {
  constructor(message: string, statusCode: number = 502) {
    super(message, statusCode, "PAPER_FETCH_ERROR");
  }
}

/**
 * 論文メタデータを取得できる形式の URL ではなかった
 *
 * 取得元の問題ではなくユーザー入力の問題なので 422 を返す
 */
export class UnsupportedPaperUrlError extends AppError {
  constructor(message: string) {
    super(message, 422, "UNSUPPORTED_PAPER_URL");
  }
}

/**
 * D1 データベースエラー
 */
export class DatabaseError extends AppError {
  constructor(message: string) {
    super(message, 500, "DATABASE_ERROR");
  }
}
