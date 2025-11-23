import { Context, Next } from "hono";
import type { HonoEnv } from "../types/bindings";

/**
 * リクエストロギングミドルウェア
 */
export async function requestLogger(
  c: Context<HonoEnv>,
  next: Next
): Promise<void> {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();

  c.set("requestId", requestId);
  c.set("startTime", startTime);

  console.log("[Request]", {
    requestId,
    method: c.req.method,
    path: c.req.path,
    timestamp: new Date().toISOString(),
  });

  await next();

  const duration = Date.now() - startTime;

  console.log("[Response]", {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
  });
}
