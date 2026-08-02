import { extractIeeeArticleNumber, normalizeDoi } from "../utils/paperUrl";
import { fetchWithRetry } from "./httpClient";

/**
 * IEEE Xplore の URL から DOI を引く
 *
 * IEEE の URL には DOI が入っておらず（article number しかない）、論文ページは
 * bot 対策で HTTP 202 / 418 が返るため読めない。公式の Metadata API だけが
 * article number から DOI を辿れる唯一の経路になる。
 *
 * ここで取るのは **DOI だけ**。書誌情報は他の論文と同じく DOI から引くので、
 * 「URL -> DOI -> 書誌 API」という全体の流れは変わらない。
 *
 * API キーは任意。未設定なら何もせず、呼び出し側は DOI URL の利用を促す。
 * 非商用の無料キーを https://developer.ieee.org/ で取得できる。
 *
 * @see https://developer.ieee.org/docs
 */
export class IeeeDoiResolver {
  private readonly API_BASE_URL = "https://ieeexploreapi.ieee.org/api/v1/search/articles";

  constructor(private readonly apiKey?: string) {}

  /**
   * IEEE Xplore の URL なら DOI を返す。対象外・キー未設定なら undefined
   *
   * @throws {Error} API がエラーを返した場合（キーが無効・上限超過など）
   */
  async resolveDoi(url: string): Promise<string | undefined> {
    const articleNumber = extractIeeeArticleNumber(url);
    if (!articleNumber || !this.apiKey) return undefined;

    const endpoint = new URL(this.API_BASE_URL);
    endpoint.searchParams.set("apikey", this.apiKey);
    endpoint.searchParams.set("article_number", articleNumber);
    endpoint.searchParams.set("format", "json");

    let response: Response;
    try {
      response = await fetchWithRetry(endpoint.toString(), {
        headers: { Accept: "application/json" },
      });
    } catch {
      // 例外にはリクエスト URL（= API キー）が乗りうるので、そのまま伝播させない
      throw new Error("IEEE Xplore API request failed");
    }

    if (!response.ok) {
      throw new Error(
        `IEEE Xplore API returned ${response.status}` +
          (response.status === 403 ? " (check IEEE_API_KEY)" : "")
      );
    }

    const body = (await response.json()) as IeeeSearchResponse;
    return normalizeDoi(body.articles?.[0]?.doi);
  }
}

interface IeeeSearchResponse {
  articles?: Array<{ doi?: string }>;
}
