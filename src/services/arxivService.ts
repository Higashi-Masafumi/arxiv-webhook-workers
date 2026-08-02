import { fetchWithRetry } from "../libs/httpClient";
import type { Paper } from "../types/paper";
import { ArxivApiError } from "../utils/errors";
import { normalizeText } from "../utils/html";
import { arxivDoi, extractArxivIdOrNull } from "../utils/paperUrl";

/**
 * ArXiv サービス
 * @see https://info.arxiv.org/help/api/basics.html
 */
export class ArxivService {
  private readonly API_BASE_URL = "https://export.arxiv.org/api/query";
  private readonly TIMEOUT = 10000; // 10秒
  private readonly MAX_RETRIES = 3;
  private readonly BASE_RETRY_DELAY_MS = 3000; // 3秒（ArXiv API の推奨インターバル）
  /**
   * arXiv は UA を名乗らない自動アクセスを弾くため、連絡先付きで名乗る
   * @see https://info.arxiv.org/help/api/tou.html
   */
  private readonly USER_AGENT =
    "arxiv-webhook-workers/1.0 (+https://github.com/Higashi-Masafumi/arxiv-webhook-workers)";

  /**
   * URL から論文情報を取得
   */
  async fetchPaperByUrl(url: string): Promise<Paper> {
    const arxivId = extractArxivIdOrNull(url);
    if (!arxivId) {
      throw new ArxivApiError(`Invalid ArXiv URL: ${url}`, 400);
    }
    return await this.fetchPaperById(arxivId);
  }

  /**
   * ArXiv ID から論文情報を取得（429 / 5xx 時はリトライ）
   */
  async fetchPaperById(arxivId: string): Promise<Paper> {
    const apiUrl = `${this.API_BASE_URL}?id_list=${encodeURIComponent(
      arxivId
    )}&max_results=1`;

    let response: Response;
    try {
      response = await fetchWithRetry(apiUrl, {
        timeoutMs: this.TIMEOUT,
        maxRetries: this.MAX_RETRIES,
        baseRetryDelayMs: this.BASE_RETRY_DELAY_MS,
        headers: {
          "User-Agent": this.USER_AGENT,
          Accept: "application/atom+xml",
        },
      });
    } catch (error) {
      throw new ArxivApiError(
        `Failed to fetch paper: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (!response.ok) {
      // 403 は arXiv 側のアクセス遮断。リトライしても回復しないので
      // 呼び出し側（PaperService）が別経路に切り替えられるよう明示する
      const hint =
        response.status === 403
          ? " (arXiv is blocking automated access from this host)"
          : "";
      throw new ArxivApiError(
        `ArXiv API returned ${response.status}${hint}`,
        response.status
      );
    }

    const xmlText = await response.text();
    return parseArxivXml(xmlText, arxivId);
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
export function parseArxivXml(xml: string, arxivId?: string): Paper {
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
  const title = normalizeText(titleMatch[1]);

  // 著者を抽出（entry内の全てのname要素）
  const authorMatches = entryXml.matchAll(/<name[^>]*>(.+?)<\/name>/g);
  const authors = Array.from(authorMatches, (match) => normalizeText(match[1]));

  if (authors.length === 0) {
    throw new ArxivApiError("Failed to parse authors from ArXiv response");
  }

  // 要約を抽出（entry内のsummary）
  const summaryMatch = entryXml.match(/<summary[^>]*>(.+?)<\/summary>/s);
  if (!summaryMatch) {
    throw new ArxivApiError("Failed to parse summary from ArXiv response");
  }
  const summary = normalizeText(summaryMatch[1]);

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
  const publishedYear = Number.parseInt(publishedMatch[1].substring(0, 4), 10);

  return {
    title,
    authors,
    summary,
    link,
    publishedYear: Number.isFinite(publishedYear) ? publishedYear : null,
    // arXiv 論文には DataCite DOI が自動で振られる
    doi: arxivId ? arxivDoi(arxivId) : undefined,
    provider: "arxiv",
  };
}
