import type { Bindings } from "../types/bindings";
import type { Integration } from "../types/d1";
import type { RefreshResult, RefreshError } from "../types/scheduled";
import { IntegrationService } from "./integrationService";
import { NotionAuthService } from "./notionAuthService";

/**
 * トークンリフレッシュサービス
 */
export class TokenRefreshService {
  private readonly HOURS_THRESHOLD = 24; // 24時間以内に期限切れになるトークンをリフレッシュ
  private integrationService: IntegrationService;
  private authService: NotionAuthService;

  constructor(private env: Bindings) {
    this.integrationService = new IntegrationService(env);
    this.authService = new NotionAuthService(env);
  }

  /**
   * 特定の Integration のトークンをリフレッシュ
   */
  async refreshToken(botId: string): Promise<void> {
    const integration = await this.integrationService.getIntegrationByBotId(
      botId
    );

    if (!integration) {
      throw new Error(`Integration not found: ${botId}`);
    }

    const refreshResponse = await this.authService.refreshAccessToken(
      integration.refresh_token
    );

    // トークンを更新（有効期限は7日後と推定）
    await this.integrationService.updateIntegration(botId, {
      access_token: refreshResponse.access_token,
      refresh_token: refreshResponse.refresh_token,
      token_expires_at: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString(),
    });
  }

  /**
   * 有効期限が近い全トークンをリフレッシュ
   */
  async refreshExpiringTokens(): Promise<RefreshResult> {
    const integrations = await this.integrationService.getExpiringIntegrations(
      this.HOURS_THRESHOLD
    );

    const result: RefreshResult = {
      total: integrations.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    for (const integration of integrations) {
      try {
        await this.refreshToken(integration.bot_id);
        result.success++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          botId: integration.bot_id,
          workspaceId: integration.workspace_id,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
      }
    }

    return result;
  }

  /**
   * トークンの有効期限をチェック
   */
  isTokenExpired(integration: Integration): boolean {
    if (!integration.token_expires_at) {
      return true; // 有効期限が設定されていない場合は期限切れとみなす
    }

    const expiresAt = new Date(integration.token_expires_at);
    return expiresAt <= new Date();
  }

  /**
   * トークンの有効期限が近いかチェック
   */
  isTokenExpiringSoon(
    integration: Integration,
    hoursThreshold: number
  ): boolean {
    if (!integration.token_expires_at) {
      return true;
    }

    const expiresAt = new Date(integration.token_expires_at);
    const threshold = new Date(Date.now() + hoursThreshold * 60 * 60 * 1000);
    return expiresAt <= threshold;
  }
}
