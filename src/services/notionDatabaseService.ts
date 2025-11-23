import { Client } from "@notionhq/client";
import type { ArxivPaper } from "../types/notion";
import { NotionApiError } from "../utils/errors";

/**
 * Notion データベースサービス
 */
export class NotionDatabaseService {
  /**
   * ArXiv 用のワークスペースを自動セットアップ
   * 1. ワークスペース直下にプライベートページを作成
   * 2. そのページ配下にデータベースを作成
   */
  async setupArxivWorkspace(
    accessToken: string
  ): Promise<{ databaseId: string; pageId: string }> {
    const notion = new Client({
      auth: accessToken,
      fetch: fetch.bind(globalThis),
    });

    try {
      // 1. ワークスペース直下にプライベートページを作成
      const page = await notion.pages.create({
        parent: {
          type: "workspace",
          workspace: true,
        },
        properties: {
          title: {
            title: [
              {
                type: "text",
                text: { content: "ArXiv Papers" },
              },
            ],
          },
        },
      });

      // 2. そのページ配下にデータベースを作成
      const database = await notion.databases.create({
        parent: {
          type: "page_id",
          page_id: page.id,
        },
        title: [
          {
            type: "text",
            text: { content: "ArXiv Papers Database" },
          },
        ],
        initial_data_source: {
          properties: {
            Title: {
              title: {},
            },
            Authors: {
              rich_text: {},
            },
            Summary: {
              rich_text: {},
            },
            Link: {
              url: {},
            },
            "Publication Year": {
              number: {
                format: "number",
              },
            },
          },
        },
      });

      return {
        databaseId: database.id,
        pageId: page.id,
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
