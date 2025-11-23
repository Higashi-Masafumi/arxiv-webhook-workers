import { Hono } from "hono";
import type { HonoEnv } from "../../types/bindings";
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
  const tokenData = await authService.exchangeCodeForToken(code);

  // 3. Workspace 保存
  await integrationService.upsertWorkspace({
    id: tokenData.workspace_id,
    workspace_name: tokenData.workspace_name,
    workspace_icon: tokenData.workspace_icon,
  });

  // 4. データベース検索または作成
  const database = await dbService.findOrCreateArxivDatabase(
    tokenData.access_token,
    tokenData.duplicated_template_id
  );

  // 5. Integration 保存
  await integrationService.createIntegration({
    bot_id: tokenData.bot_id,
    workspace_id: tokenData.workspace_id,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_expires_at: new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString(),
    database_id: database.id,
    duplicated_template_id: tokenData.duplicated_template_id,
  });

  // 6. 成功ページ表示
  const successHtml = generateSuccessPage(
    database.id,
    tokenData.workspace_id,
    c.env.WORKER_URL
  );

  return c.html(successHtml);
});

/**
 * 成功ページの HTML を生成
 */
function generateSuccessPage(
  databaseId: string,
  workspaceId: string,
  workerUrl: string
): string {
  return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Notion 連携完了</title>
    <style>
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 800px;
        margin: 50px auto;
        padding: 20px;
        line-height: 1.6;
      }
      h1 { color: #2eaadc; }
      h2 { color: #333; margin-top: 30px; }
      code {
        background: #f4f4f4;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 0.9em;
      }
      pre {
        background: #f4f4f4;
        padding: 15px;
        border-radius: 5px;
        overflow-x: auto;
      }
      ol { padding-left: 20px; }
      li { margin: 10px 0; }
      a { color: #2eaadc; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <h1>✅ 連携が完了しました</h1>
    <p>
      データベース:
      <a href="https://notion.so/${databaseId}" target="_blank">ArXiv Papers</a>
    </p>

    <h2>次のステップ</h2>
    <p>
      Notion Automation を設定して、論文 URL
      を入力すると自動的にメタデータが取得されるようにします。
    </p>

    <ol>
      <li>Notion で上記データベースを開く</li>
      <li>右上の「...」→「Automations」→「New automation」</li>
      <li>トリガー: 「When a page is updated」</li>
      <li>アクション: 「Send HTTP request」</li>
      <li>URL: <code>${workerUrl}/notion/webhook</code></li>
      <li>Method: <code>POST</code></li>
      <li>
        Body: JSON形式で以下を設定
        <pre>{
  "workspace_id": "${workspaceId}",
  "page_id": "{{page_id}}",
  "link": "{{Link}}"
}</pre>
      </li>
    </ol>

    <h2>使い方</h2>
    <ol>
      <li>データベースに新しいページを作成</li>
      <li>
        Link プロパティに ArXiv URL を入力（例:
        <code>https://arxiv.org/abs/2301.12345</code>）
      </li>
      <li>数秒後、自動的にタイトル・著者・要約が入力されます</li>
    </ol>
  </body>
</html>`;
}

export default app;
