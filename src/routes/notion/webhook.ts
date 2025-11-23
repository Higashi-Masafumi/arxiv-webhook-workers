import { Hono } from "hono";
import type { HonoEnv } from "../../types/bindings";
import type { WebhookPayload, WebhookResponse } from "../../types/webhook";
import { IntegrationService } from "../../services/integrationService";
import { TokenRefreshService } from "../../services/tokenRefreshService";
import { ArxivService } from "../../services/arxivService";
import { NotionDatabaseService } from "../../services/notionDatabaseService";
import { validateRequired, validateArxivUrl } from "../../utils/validation";
import { NotFoundError, ValidationError } from "../../utils/errors";

const app = new Hono<HonoEnv>();

/**
 * Webhook 受信
 */
app.post("/", async (c) => {
  const payload = await c.req.json<WebhookPayload>();

  // 1. バリデーション
  validateRequired(payload, ["workspace_id", "page_id", "link"]);

  if (!validateArxivUrl(payload.link)) {
    throw new ValidationError("Invalid ArXiv URL");
  }

  // 2. Integration 取得
  const integrationService = new IntegrationService(c.env);
  let integration = await integrationService.getIntegrationByWorkspaceId(
    payload.workspace_id
  );

  if (!integration) {
    throw new NotFoundError("Integration not found");
  }

  // 3. トークン有効期限チェック & リフレッシュ
  const tokenRefreshService = new TokenRefreshService(c.env);
  if (tokenRefreshService.isTokenExpired(integration)) {
    await tokenRefreshService.refreshToken(integration.bot_id);
    // 再取得
    integration = await integrationService.getIntegrationByBotId(
      integration.bot_id
    );
    if (!integration) {
      throw new NotFoundError("Integration not found after refresh");
    }
  }

  // 4. ArXiv データ取得
  const arxivService = new ArxivService();
  const paper = await arxivService.fetchPaperByUrl(payload.link);

  // 5. Notion 更新
  const dbService = new NotionDatabaseService();
  await dbService.updatePage(integration.access_token, payload.page_id, paper);

  const response: WebhookResponse = {
    success: true,
    page_id: payload.page_id,
    updated_at: new Date().toISOString(),
  };

  return c.json(response);
});

export default app;
