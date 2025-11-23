import { Hono } from "hono";
import type { HonoEnv } from "./types/bindings";
import { requestLogger } from "./middleware/requestLogger";
import { errorHandler } from "./middleware/errorHandler";
import connectRoute from "./routes/notion/connect";
import callbackRoute from "./routes/notion/callback";
import webhookRoute from "./routes/notion/webhook";
import refreshTokenRoute from "./routes/notion/refreshToken";

const app = new Hono<HonoEnv>();

// ミドルウェア
app.use("*", requestLogger);
app.onError(errorHandler);

// ヘルスチェック
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "arxiv-webhook-workers",
    timestamp: new Date().toISOString(),
  });
});

// ルート
app.route("/notion/connect", connectRoute);
app.route("/notion/callback", callbackRoute);
app.route("/notion/webhook", webhookRoute);
app.route("/notion/refresh-token", refreshTokenRoute);

export default app;

// Cron Triggers のエクスポート
export { default as scheduled } from "./scheduled";
