import { APIResponseError, Client, isFullDatabase } from "@notionhq/client";
import type { ArxivPaper } from "../types/notion";
import { NotionApiError } from "../utils/errors";

/**
 * Notion データベースサービス
 */
export class NotionDatabaseService {
  /**
   * ArXiv 用のデータベースを自動セットアップ
   * 既存の database_id が指定されていれば再利用し、存在しない場合は再作成する
   */
  async setupArxivWorkspace(
    accessToken: string,
    existingDatabaseId?: string | null
  ): Promise<{ databaseId: string; pageId: string | null }> {
    const notion = new Client({
      auth: accessToken,
      fetch: fetch.bind(globalThis),
    });

    try {
      if (existingDatabaseId) {
        try {
          const existing = await notion.databases.retrieve({
            database_id: existingDatabaseId,
          });

          if (!isFullDatabase(existing)) {
            throw new NotionApiError("Invalid database response");
          }

          return {
            databaseId: existing.id,
            pageId:
              existing.parent.type === "page_id"
                ? existing.parent.page_id
                : null,
          };
        } catch (error) {
          // 404 error でない場合のみエラーをスロー
          if (!(error instanceof APIResponseError && error.status === 404)) {
            throw error;
          }
          // 404 の場合は既存データベースが存在しないため、
          // 以下の処理で新規作成される
        }
      }

      // 既存データベースが存在しない、または404エラーの場合に新規作成
      const database = await notion.databases.create({
        parent: {
          type: "workspace",
          workspace: true,
        },
        title: [
          {
            type: "text",
            text: { content: "ArXiv Papers" },
          },
        ],
        initial_data_source: {
          properties: {
            Title: {
              type: "title",
              title: {},
            },
            Authors: {
              type: "rich_text",
              rich_text: {},
            },
            Summary: {
              type: "rich_text",
              rich_text: {},
            },
            Link: {
              type: "url",
              url: {},
            },
            "Publication Year": {
              type: "number",
              number: {},
            },
          },
        },
      });

      return {
        databaseId: database.id,
        pageId: null, // ワークスペース直下なので親ページなし
      };
    } catch (error) {
      throw new NotionApiError(
        `Failed to setup ArXiv workspace: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * ページを更新
   */
  async updatePage(
    accessToken: string,
    pageId: string,
    paper: ArxivPaper
  ): Promise<void> {
    const notion = new Client({
      auth: accessToken,
      fetch: fetch.bind(globalThis),
    });

    try {
      await notion.pages.update({
        page_id: pageId,
        properties: {
          Title: {
            title: [
              {
                type: "text",
                text: { content: paper.title.slice(0, 2000) }, // 2000文字制限
              },
            ],
          },
          Authors: {
            rich_text: this.splitRichText(paper.authors.join(", ")),
          },
          Summary: {
            rich_text: this.splitRichText(paper.summary),
          },
          Link: {
            url: paper.link,
          },
          "Publication Year": {
            number: paper.publishedYear,
          },
        },
      });
    } catch (error) {
      throw new NotionApiError(
        `Failed to update page: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Rich text を分割（2000文字制限対応）
   */
  private splitRichText(
    text: string,
    maxLength: number = 2000
  ): Array<{ type: "text"; text: { content: string } }> {
    const chunks: Array<{ type: "text"; text: { content: string } }> = [];

    for (let i = 0; i < text.length; i += maxLength) {
      chunks.push({
        type: "text",
        text: { content: text.slice(i, i + maxLength) },
      });
    }

    return chunks;
  }
}
