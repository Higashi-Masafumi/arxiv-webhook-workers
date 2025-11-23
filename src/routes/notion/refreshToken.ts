import { Hono } from "hono";
import type { HonoEnv } from "../../types/bindings";
import { IntegrationService } from "../../services/integrationService";
import { TokenRefreshService } from "../../services/tokenRefreshService";
import { validateRequired } from "../../utils/validation";
import { NotFoundError } from "../../utils/errors";

const app = new Hono<HonoEnv>();

/**
 * 手動トークンリフレッシュ
 */
app.post("/", async (c) => {
  const body = await c.req.json<{ workspace_id: string }>();

  validateRequired(body, ["workspace_id"]);

  const integrationService = new IntegrationService(c.env);
  const integration = await integrationService.getIntegrationByWorkspaceId(
    body.workspace_id
  );

  if (!integration) {
    throw new NotFoundError("Integration not found");
  }

  const tokenRefreshService = new TokenRefreshService(c.env);
  await tokenRefreshService.refreshToken(integration.bot_id);

  return c.json({
    success: true,
    message: "Token refreshed successfully",
  });
});

export default app;
