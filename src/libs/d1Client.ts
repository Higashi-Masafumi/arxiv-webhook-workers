/**
 * D1 クライアントヘルパー
 */
export class D1Client {
  constructor(private db: D1Database) {}

  /**
   * 単一レコードを取得
   */
  async getOne<T>(query: string, ...params: unknown[]): Promise<T | null> {
    const result = await this.db
      .prepare(query)
      .bind(...params)
      .first<T>();
    return result || null;
  }

  /**
   * 複数レコードを取得
   */
  async getAll<T>(query: string, ...params: unknown[]): Promise<T[]> {
    const result = await this.db
      .prepare(query)
      .bind(...params)
      .all<T>();
    return result.results || [];
  }

  /**
   * INSERT/UPDATE/DELETE を実行
   */
  async execute(query: string, ...params: unknown[]): Promise<D1Result> {
    return await this.db
      .prepare(query)
      .bind(...params)
      .run();
  }

  /**
   * トランザクション実行
   */
  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    return await this.db.batch(statements);
  }

  /**
   * PreparedStatement を作成
   */
  prepare(query: string): D1PreparedStatement {
    return this.db.prepare(query);
  }
}
