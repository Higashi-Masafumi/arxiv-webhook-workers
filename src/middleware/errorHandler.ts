import type { Context } from "hono";
import type { HonoEnv } from "../types/bindings";
import { AppError } from "../utils/errors";

/**
 * エラーハンドリングミドルウェア
 */
export async function errorHandler(
  err: Error,
  c: Context<HonoEnv>
): Promise<Response> {
  console.error("[Error]", {
    timestamp: new Date().toISOString(),
    path: c.req.path,
    method: c.req.method,
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
    },
  });

  const errorResponse = {
    error: {
      code: err instanceof AppError ? err.code : "INTERNAL_ERROR",
      message:
        err instanceof AppError ? err.message : "An unexpected error occurred",
    },
  };

  const statusCode = err instanceof AppError ? err.statusCode : 500;

  return new Response(JSON.stringify(errorResponse), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
