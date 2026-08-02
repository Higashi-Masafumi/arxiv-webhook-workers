import { Hono } from "hono";
import type { HonoEnv } from "../../types/bindings";
import type {
  NotionAutomationPayload,
  WebhookResponse,
} from "../../types/webhook";
import { parsePublicHttpUrl } from "../../utils/paperUrl";
import { IntegrationService } from "../../services/integrationService";
import { TokenRefreshService } from "../../services/tokenRefreshService";
import { PaperService } from "../../services/paperService";
import { NotionDatabaseService } from "../../services/notionDatabaseService";
import { NotFoundError, ValidationError } from "../../utils/errors";

const app = new Hono<HonoEnv>();

/**
 * Webhook 受信（Notion Automation 専用）
 */
app.post("/", async (c) => {
  const payload = await c.req.json<NotionAutomationPayload>();

  // 1. ペイロード構造のバリデーション
  if (
    !payload.source ||
    payload.source.type !== "automation" ||
    !payload.data ||
    payload.data.object !== "page"
  ) {
    throw new ValidationError("Invalid Notion Automation payload");
  }

  // 2. 必要なデータを抽出
  const pageId = payload.data.id;
  const databaseId = payload.data.parent.database_id;
  const paperUrl = payload.data.properties.Link?.url;

  if (!paperUrl) {
    throw new ValidationError("Link property is empty");
  }

  // 3. 論文 URL のバリデーション
  // 取得できるかは PaperService が判断する。ここでは「取得しに行ってよい宛先か」だけ見る
  try {
    parsePublicHttpUrl(paperUrl);
  } catch (error) {
    throw new ValidationError(
      `Link property is not a fetchable paper URL: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // 4. Integration を database_id から取得
  const integrationService = new IntegrationService(c.env);
  let integration = await integrationService.getIntegrationByDatabaseId(
    databaseId
  );

  if (!integration) {
    throw new NotFoundError("Integration not found for this database");
  }

  // 5. トークン有効期限チェック & リフレッシュ
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

  // 6. 論文メタデータ取得（URL -> DOI -> 書誌 API）
  const paperService = new PaperService(c.env);
  const paper = await paperService.fetchPaperByUrl(paperUrl);

  console.log(
    `[Webhook] Fetched paper via ${paper.provider}: ${paper.title} (page ${pageId})`
  );

  // 7. Notion 更新
  const dbService = new NotionDatabaseService();
  await dbService.updatePage(integration.access_token, pageId, paper);

  const response: WebhookResponse = {
    success: true,
    page_id: pageId,
    updated_at: new Date().toISOString(),
  };

  return c.json(response);
});

export default app;
