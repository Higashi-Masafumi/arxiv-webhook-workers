import { Client } from "@notionhq/client";
import type { ArxivPaper } from "../types/notion";
import { NotionApiError } from "../utils/errors";

/**
 * Notion データベースサービス
 */
export class NotionDatabaseService {
  /**
   * ArXiv 用のデータベースを自動セットアップ
   * ワークスペース直下にデータベースを直接作成
   */
  async setupArxivWorkspace(
    accessToken: string
  ): Promise<{ databaseId: string; pageId: string | null }> {
    const notion = new Client({
      auth: accessToken,
      fetch: fetch.bind(globalThis),
    });

    try {
      // ワークスペース直下にデータベースを直接作成
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
