import { Client } from "@notionhq/client";
import type {
  OauthTokenResponse,
  OauthTokenParameters,
} from "@notionhq/client/build/src/api-endpoints";
import type { Bindings } from "../types/bindings";
import type { OAuthState } from "../types/kv";
import { KVKeys } from "../types/kv";
import { AuthenticationError, AuthorizationError } from "../utils/errors";

/**
 * Notion 認証サービス
 */
export class NotionAuthService {
  private readonly STATE_EXPIRATION_SECONDS = 600; // 10分
  private readonly client: Client;

  constructor(private env: Bindings) {
    // Cloudflare Workers 環境向けに fetch を明示的にバインド
    this.client = new Client({
      fetch: fetch.bind(globalThis),
    });
  }

  /**
   * OAuth 認可 URL を生成
   */
  async generateAuthUrl(): Promise<string> {
    const state = crypto.randomUUID();

    // State を KV に保存
    const stateData: OAuthState = {
      createdAt: Date.now(),
    };

    await this.env.KV.put(KVKeys.oauthState(state), JSON.stringify(stateData), {
      expirationTtl: this.STATE_EXPIRATION_SECONDS,
    });

    // OAuth URL を構築
    const params = new URLSearchParams({
      client_id: this.env.NOTION_CLIENT_ID,
      redirect_uri: `${this.env.WORKER_URL}/notion/callback`,
      response_type: "code",
      owner: "user",
      state,
    });

    return `https://api.notion.com/v1/oauth/authorize?${params.toString()}`;
  }

  /**
   * State を検証
   */
  async verifyState(state: string): Promise<OAuthState> {
    const stateDataStr = await this.env.KV.get(KVKeys.oauthState(state));

    if (!stateDataStr) {
      throw new AuthorizationError("Invalid or expired state");
    }

    const stateData: OAuthState = JSON.parse(stateDataStr);

    // State を削除（一度しか使えない）
    await this.env.KV.delete(KVKeys.oauthState(state));

    return stateData;
  }

  /**
   * 認可コードをアクセストークンに交換
   */
  async exchangeCodeForToken(code: string): Promise<OauthTokenResponse> {
    try {
      const params: OauthTokenParameters & {
        client_id: string;
        client_secret: string;
      } = {
        grant_type: "authorization_code",
        code,
        redirect_uri: `${this.env.WORKER_URL}/notion/callback`,
        client_id: this.env.NOTION_CLIENT_ID,
        client_secret: this.env.NOTION_CLIENT_SECRET,
      };

      return await this.client.oauth.token(params);
    } catch (error) {
      throw new AuthenticationError(
        `Failed to exchange code for token: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * トークンをリフレッシュ
   */
  async refreshAccessToken(refreshToken: string): Promise<OauthTokenResponse> {
    try {
      const params: OauthTokenParameters & {
        client_id: string;
        client_secret: string;
      } = {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.env.NOTION_CLIENT_ID,
        client_secret: this.env.NOTION_CLIENT_SECRET,
      };

      return await this.client.oauth.token(params);
    } catch (error) {
      throw new AuthenticationError(
        `Failed to refresh token: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
