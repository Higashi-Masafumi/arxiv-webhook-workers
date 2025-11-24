import { Hono } from "hono";
import type { HonoEnv } from "../../types/bindings";
import type { OauthTokenResponse } from "@notionhq/client/build/src/api-endpoints";
import { NotionAuthService } from "../../services/notionAuthService";
import { NotionDatabaseService } from "../../services/notionDatabaseService";
import { IntegrationService } from "../../services/integrationService";
import { ValidationError } from "../../utils/errors";

const app = new Hono<HonoEnv>();

/**
 * OAuth コールバック処理
 */
app.get("/", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    throw new ValidationError("Missing code or state parameter");
  }

  const authService = new NotionAuthService(c.env);
  const dbService = new NotionDatabaseService();
  const integrationService = new IntegrationService(c.env);

  // 1. State 検証
  await authService.verifyState(state);

  // 2. アクセストークン・リフレッシュトークン取得
  const tokenData: OauthTokenResponse = await authService.exchangeCodeForToken(
    code
  );

  // 3. 既存連携の取得（冪等性確保）
  const existingIntegration = await integrationService.getIntegrationByWorkspaceId(
    tokenData.workspace_id
  );

  // 4. Workspace 保存
  await integrationService.upsertWorkspace({
    id: tokenData.workspace_id,
    workspace_name: tokenData.workspace_name,
    workspace_icon: tokenData.workspace_icon,
  });

  // 5. ArXiv ワークスペースを自動セットアップ（ページ + データベース作成）
  const { databaseId, pageId } = await dbService.setupArxivWorkspace(
    tokenData.access_token,
    existingIntegration?.database_id
  );

  // 6. Integration 保存
  const integrationPayload = {
    bot_id: tokenData.bot_id,
    workspace_id: tokenData.workspace_id,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token ?? "", // refresh_token が null の場合は空文字列
    token_expires_at: new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString(),
    database_id: databaseId,
    parent_page_id: pageId,
  } as const;

  if (existingIntegration) {
    await integrationService.updateIntegration(existingIntegration.bot_id, {
      access_token: integrationPayload.access_token,
      refresh_token: integrationPayload.refresh_token,
      token_expires_at: integrationPayload.token_expires_at,
      database_id: integrationPayload.database_id,
      parent_page_id: integrationPayload.parent_page_id,
    });
  } else {
    await integrationService.createIntegration(integrationPayload);
  }

  // 7. 成功ページにリダイレクト（public/success.html を使用）
  // URL パラメータでデータを渡し、クライアントサイドで処理
  const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
  const successUrl = new URL("/success.html", workerUrl);
  successUrl.searchParams.set("database_id", databaseId);
  successUrl.searchParams.set("worker_url", workerUrl);

  return c.redirect(successUrl.toString());
});

export default app;
