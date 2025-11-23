import { Hono } from "hono";
import type { HonoEnv } from "../../types/bindings";
import { NotionAuthService } from "../../services/notionAuthService";

const app = new Hono<HonoEnv>();

/**
 * OAuth 認証開始
 */
app.get("/", async (c) => {
  const authService = new NotionAuthService(c.env);
  const authUrl = await authService.generateAuthUrl();

  return c.redirect(authUrl);
});

export default app;
