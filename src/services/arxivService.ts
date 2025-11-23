import type { ArxivPaper } from "../types/notion";
import { ArxivApiError } from "../utils/errors";
import { extractArxivId } from "../utils/validation";

/**
 * ArXiv サービス
 * @see https://info.arxiv.org/help/api/basics.html
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
   * ArXiv API の Atom XML レスポンスをパース
   * @see https://info.arxiv.org/help/api/basics.html
   *
   * XML構造:
   * <feed>
   *   <title>ArXiv Query: ...</title>  <- フィード全体のタイトル
   *   <id>...</id>                      <- フィード全体のID
   *   <entry>
   *     <id>http://arxiv.org/abs/...</id>     <- 論文のID
   *     <title>論文タイトル</title>
   *     <summary>論文要約</summary>
   *     <author><name>著者名</name></author>
   *     <published>2023-01-15T...</published>
   *   </entry>
   * </feed>
   */
  private parseArxivXml(xml: string): ArxivPaper {
    // entry タグ内のコンテンツを抽出
    const entryMatch = xml.match(/<entry[^>]*>([\s\S]*?)<\/entry>/);
    if (!entryMatch) {
      throw new ArxivApiError("No entry found in ArXiv response");
    }
    const entryXml = entryMatch[1];

    // タイトルを抽出（entry内のtitle）
    const titleMatch = entryXml.match(/<title[^>]*>(.+?)<\/title>/s);
    if (!titleMatch) {
      throw new ArxivApiError("Failed to parse title from ArXiv response");
    }
    const title = this.normalizeText(titleMatch[1]);

    // 著者を抽出（entry内の全てのname要素）
    const authorMatches = entryXml.matchAll(/<name[^>]*>(.+?)<\/name>/g);
    const authors = Array.from(authorMatches, (match) =>
      this.normalizeText(match[1])
    );

    if (authors.length === 0) {
      throw new ArxivApiError("Failed to parse authors from ArXiv response");
    }

    // 要約を抽出（entry内のsummary）
    const summaryMatch = entryXml.match(/<summary[^>]*>(.+?)<\/summary>/s);
    if (!summaryMatch) {
      throw new ArxivApiError("Failed to parse summary from ArXiv response");
    }
    const summary = this.normalizeText(summaryMatch[1]);

    // リンクを抽出（entry内のid要素）
    const linkMatch = entryXml.match(/<id[^>]*>(.+?)<\/id>/s);
    if (!linkMatch) {
      throw new ArxivApiError("Failed to parse link from ArXiv response");
    }
    const link = linkMatch[1].trim();

    // 公開日を抽出（entry内のpublished要素）
    const publishedMatch = entryXml.match(/<published[^>]*>(.+?)<\/published>/);
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
