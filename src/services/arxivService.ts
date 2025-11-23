import type { ArxivPaper } from "../types/notion";
import { ArxivApiError } from "../utils/errors";
import { extractArxivId } from "../utils/validation";

/**
 * ArXiv サービス
 */
export class ArxivService {
  private readonly API_BASE_URL = "http://export.arxiv.org/api/query";
  private readonly TIMEOUT = 10000; // 10秒

  /**
   * URL から論文情報を取得
   */
  async fetchPaperByUrl(url: string): Promise<ArxivPaper> {
    const arxivId = extractArxivId(url);
    return await this.fetchPaperById(arxivId);
  }

  /**
   * ArXiv ID から論文情報を取得
   */
  async fetchPaperById(arxivId: string): Promise<ArxivPaper> {
    const apiUrl = `${this.API_BASE_URL}?id_list=${arxivId}&max_results=1`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT);

      const response = await fetch(apiUrl, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new ArxivApiError(
          `ArXiv API returned ${response.status}`,
          response.status
        );
      }

      const xmlText = await response.text();
      return this.parseArxivXml(xmlText);
    } catch (error) {
      if (error instanceof ArxivApiError) {
        throw error;
      }
      throw new ArxivApiError(
        `Failed to fetch paper: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * ArXiv API の XML レスポンスをパース
   */
  private parseArxivXml(xml: string): ArxivPaper {
    // タイトルを抽出
    const titleMatch = xml.match(/<title>(.+?)<\/title>/s);
    if (!titleMatch || titleMatch.index === 0) {
      // 最初の<title>はフィード全体のタイトルなのでスキップ
      const secondTitleMatch = xml.match(
        /<title>.*?<\/title>.*?<title>(.+?)<\/title>/s
      );
      if (!secondTitleMatch) {
        throw new ArxivApiError("Failed to parse title from ArXiv response");
      }
      var title = this.normalizeText(secondTitleMatch[1]);
    } else {
      var title = this.normalizeText(titleMatch[1]);
    }

    // 著者を抽出
    const authorMatches = xml.matchAll(/<name>(.+?)<\/name>/g);
    const authors = Array.from(authorMatches, (match) =>
      this.normalizeText(match[1])
    );

    if (authors.length === 0) {
      throw new ArxivApiError("Failed to parse authors from ArXiv response");
    }

    // 要約を抽出
    const summaryMatch = xml.match(/<summary>(.+?)<\/summary>/s);
    if (!summaryMatch) {
      throw new ArxivApiError("Failed to parse summary from ArXiv response");
    }
    const summary = this.normalizeText(summaryMatch[1]);

    // リンクを抽出
    const linkMatch = xml.match(/<id>(.+?)<\/id>/s);
    if (!linkMatch || linkMatch.index === 0) {
      // 最初の<id>はフィード全体のIDなのでスキップ
      const secondLinkMatch = xml.match(/<id>.*?<\/id>.*?<id>(.+?)<\/id>/s);
      if (!secondLinkMatch) {
        throw new ArxivApiError("Failed to parse link from ArXiv response");
      }
      var link = secondLinkMatch[1].trim();
    } else {
      var link = linkMatch[1].trim();
    }

    // 公開日を抽出
    const publishedMatch = xml.match(/<published>(.+?)<\/published>/);
    if (!publishedMatch) {
      throw new ArxivApiError(
        "Failed to parse published date from ArXiv response"
      );
    }
    const publishedYear = parseInt(publishedMatch[1].substring(0, 4), 10);

    return {
      title,
      authors,
      summary,
      link,
      publishedYear,
    };
  }

  /**
   * テキストを正規化（改行・余分な空白を削除）
   */
  private normalizeText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }
}
