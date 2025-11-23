import type { Bindings } from "../types/bindings";
import type {
  Integration,
  CreateIntegrationInput,
  UpdateIntegrationInput,
  CreateWorkspaceInput,
} from "../types/d1";
import { D1Client } from "../libs/d1Client";
import { DatabaseError, NotFoundError } from "../utils/errors";

/**
 * Integration 管理サービス
 */
export class IntegrationService {
  private d1: D1Client;

  constructor(private env: Bindings) {
    this.d1 = new D1Client(env.arxiv_notion_db);
  }

  /**
   * Workspace を作成または更新
   */
  async upsertWorkspace(input: CreateWorkspaceInput): Promise<void> {
    try {
      await this.d1.execute(
        `INSERT INTO workspaces (id, workspace_name, workspace_icon, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           workspace_name = excluded.workspace_name,
           workspace_icon = excluded.workspace_icon,
           updated_at = CURRENT_TIMESTAMP`,
        input.id,
        input.workspace_name,
        input.workspace_icon
      );
    } catch (error) {
      throw new DatabaseError(
        `Failed to upsert workspace: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Integration を作成
   */
  async createIntegration(input: CreateIntegrationInput): Promise<void> {
    try {
      await this.d1.execute(
        `INSERT INTO integrations (
          bot_id, workspace_id, access_token, refresh_token,
          token_expires_at, database_id, duplicated_template_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        input.bot_id,
        input.workspace_id,
        input.access_token,
        input.refresh_token,
        input.token_expires_at || null,
        input.database_id || null,
        input.duplicated_template_id || null
      );
    } catch (error) {
      throw new DatabaseError(
        `Failed to create integration: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Integration を取得（workspace_id で検索）
   */
  async getIntegrationByWorkspaceId(
    workspaceId: string
  ): Promise<Integration | null> {
    try {
      return await this.d1.getOne<Integration>(
        `SELECT * FROM integrations WHERE workspace_id = ?`,
        workspaceId
      );
    } catch (error) {
      throw new DatabaseError(
        `Failed to get integration: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Integration を取得（bot_id で検索）
   */
  async getIntegrationByBotId(botId: string): Promise<Integration | null> {
    try {
      return await this.d1.getOne<Integration>(
        `SELECT * FROM integrations WHERE bot_id = ?`,
        botId
      );
    } catch (error) {
      throw new DatabaseError(
        `Failed to get integration: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Integration を更新
   */
  async updateIntegration(
    botId: string,
    input: UpdateIntegrationInput
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (input.access_token !== undefined) {
      updates.push("access_token = ?");
      params.push(input.access_token);
    }
    if (input.refresh_token !== undefined) {
      updates.push("refresh_token = ?");
      params.push(input.refresh_token);
    }
    if (input.token_expires_at !== undefined) {
      updates.push("token_expires_at = ?");
      params.push(input.token_expires_at);
    }
    if (input.database_id !== undefined) {
      updates.push("database_id = ?");
      params.push(input.database_id);
    }

    if (updates.length === 0) {
      return; // 更新する項目がない
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    params.push(botId);

    try {
      await this.d1.execute(
        `UPDATE integrations SET ${updates.join(", ")} WHERE bot_id = ?`,
        ...params
      );
    } catch (error) {
      throw new DatabaseError(
        `Failed to update integration: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Integration を削除
   */
  async deleteIntegration(botId: string): Promise<void> {
    try {
      await this.d1.execute(`DELETE FROM integrations WHERE bot_id = ?`, botId);
    } catch (error) {
      throw new DatabaseError(
        `Failed to delete integration: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 有効期限が近い Integration を取得
   */
  async getExpiringIntegrations(
    hoursUntilExpiry: number
  ): Promise<Integration[]> {
    try {
      return await this.d1.getAll<Integration>(
        `SELECT * FROM integrations
         WHERE token_expires_at < datetime('now', '+' || ? || ' hours')
         OR token_expires_at IS NULL
         ORDER BY token_expires_at ASC`,
        hoursUntilExpiry
      );
    } catch (error) {
      throw new DatabaseError(
        `Failed to get expiring integrations: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
