import { Client } from "@notionhq/client";
import type { ArxivPaper } from "../types/notion";
import { NotionApiError } from "../utils/errors";

/**
 * Notion データベースサービス
 */
export class NotionDatabaseService {
  /**
   * データベースを検索または作成
   */
  async findOrCreateArxivDatabase(
    accessToken: string,
    duplicatedTemplateId: string | null
  ): Promise<{ id: string }> {
    const notion = new Client({
      auth: accessToken,
      fetch: fetch.bind(globalThis),
    });

    // データベースを検索
    try {
      const searchResponse = await notion.search({
        filter: {
          value: "data_source",
          property: "object",
        },
        sort: {
          direction: "descending",
          timestamp: "last_edited_time",
        },
      });

      // "ArXiv Papers" という名前のデータベースを探す
      const arxivDatabase = searchResponse.results.find((result) => {
        // data_source オブジェクトをチェック
        if ("title" in result) {
          const title = result.title[0];
          return (
            title &&
            "plain_text" in title &&
            title.plain_text === "ArXiv Papers"
          );
        }
        return false;
      });

      if (arxivDatabase) {
        return { id: arxivDatabase.id };
      }

      // 見つからない場合は新規作成
      const parentPageId = duplicatedTemplateId || undefined;
      if (!parentPageId) {
        throw new NotionApiError(
          "No database found and no parent page ID provided"
        );
      }

      return await this.createArxivDatabase(accessToken, parentPageId);
    } catch (error) {
      throw new NotionApiError(
        `Failed to find or create database: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * ArXiv データベースを作成
   */
  async createArxivDatabase(
    accessToken: string,
    parentPageId: string
  ): Promise<{ id: string }> {
    const notion = new Client({
      auth: accessToken,
      fetch: fetch.bind(globalThis),
    });

    try {
      const database = await notion.dataSources.create({
        parent: {
          type: "database_id",
          database_id: parentPageId,
        },
        title: [
          {
            type: "text",
            text: { content: "ArXiv Papers" },
          },
        ],
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
      });

      return { id: database.id };
    } catch (error) {
      throw new NotionApiError(
        `Failed to create database: ${
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
