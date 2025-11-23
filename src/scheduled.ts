import type { ScheduledEvent, CronJobResult } from "./types/scheduled";
import type { Bindings } from "./types/bindings";
import { TokenRefreshService } from "./services/tokenRefreshService";

/**
 * Cron Triggers のエントリーポイント
 */
export default {
  async scheduled(
    event: ScheduledEvent,
    env: Bindings,
    ctx: ExecutionContext
  ): Promise<void> {
    const startTime = new Date().toISOString();

    console.log(`[Cron] Token refresh started at ${startTime}`);
    console.log(
      `[Cron] Scheduled time: ${new Date(event.scheduledTime).toISOString()}`
    );
    console.log(`[Cron] Cron expression: ${event.cron}`);

    try {
      const refreshService = new TokenRefreshService(env);
      const result = await refreshService.refreshExpiringTokens();

      const endTime = new Date().toISOString();
      const duration = Date.now() - new Date(startTime).getTime();

      const jobResult: CronJobResult = {
        jobName: "token-refresh",
        startTime,
        endTime,
        duration,
        success: result.failed === 0,
        message: `Total: ${result.total}, Success: ${result.success}, Failed: ${result.failed}`,
      };

      console.log(`[Cron] Token refresh completed:`, jobResult);

      if (result.failed > 0) {
        console.error(`[Cron] Refresh errors:`, result.errors);
      }
    } catch (error) {
      const endTime = new Date().toISOString();
      const duration = Date.now() - new Date(startTime).getTime();

      const jobResult: CronJobResult = {
        jobName: "token-refresh",
        startTime,
        endTime,
        duration,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };

      console.error(`[Cron] Token refresh failed:`, jobResult);
      throw error;
    }
  },
};
