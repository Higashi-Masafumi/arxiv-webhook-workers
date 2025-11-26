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
 * ArXiv API エラー
 */
export class ArxivApiError extends AppError {
  constructor(message: string, statusCode: number = 502) {
    super(message, statusCode, "ARXIV_API_ERROR");
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

/**
 * 翻訳エラー
 */
export class TranslationError extends AppError {
  constructor(message: string) {
    super(message, 500, "TRANSLATION_ERROR");
  }
}
