/**
 * Notion Automation からの Webhook Payload
 * @see https://www.notion.so/help/automations
 */
export interface NotionAutomationPayload {
  source: {
    type: "automation";
    automation_id: string;
    action_id: string;
    event_id: string;
    attempt: number;
  };
  data: {
    object: "page";
    id: string; // page_id
    created_time: string;
    last_edited_time: string;
    created_by: {
      object: "user";
      id: string;
    };
    last_edited_by: {
      object: "user";
      id: string;
    };
    cover: unknown;
    icon: unknown;
    parent: {
      type: "database_id";
      database_id: string;
    };
    archived: boolean;
    in_trash: boolean;
    properties: {
      Link?: {
        id: string;
        type: "url";
        url: string | null;
      };
      [key: string]: unknown;
    };
    url: string;
    public_url: string | null;
    request_id: string;
  };
}
/**
 * Webhook レスポンス
 */
export interface WebhookResponse {
  success: boolean;
  page_id: string;
  updated_at: string;
  error?: {
    code: string;
    message: string;
  };
}
