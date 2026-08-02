import type { Paper } from "../types/paper";
import { htmlToText, normalizeText } from "../utils/html";
import { normalizeDoi } from "../utils/paperUrl";
import type { DoiMetadataProvider } from "../services/paperService";
import { fetchWithRetry } from "./httpClient";

/**
 * OpenAlex API クライアント
 *
 * 主取得元。arXiv から商業出版社まで DOI を持つ文献をひと通り収録している。
 * 著作権上の理由から abstract は「単語 -> 出現位置」の転置インデックスで返るため、
 * 復元処理が必要。
 *
 * @see https://docs.openalex.org/api-entities/works
 */
export class OpenAlexClient implements DoiMetadataProvider {
  readonly name = "OpenAlex";
  private readonly API_BASE_URL = "https://api.openalex.org/works";

  /**
   * @param contactEmail OpenAlex の "polite pool" 用連絡先
   */
  constructor(private readonly contactEmail?: string) {}

  /**
   * DOI から書誌情報を取得する。見つからなければ null
   */
  async fetchByDoi(doi: string): Promise<Paper | null> {
    const url = new URL(`${this.API_BASE_URL}/doi:${doi}`);
    if (this.contactEmail) {
      url.searchParams.set("mailto", this.contactEmail);
    }

    const response = await fetchWithRetry(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`OpenAlex API returned ${response.status}`);
    }

    const work = (await response.json()) as OpenAlexWork;
    return toPaper(work, doi);
  }
}

interface OpenAlexWork {
  doi?: string;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  authorships?: Array<{
    author?: { display_name?: string | null };
    raw_author_name?: string | null;
  }>;
  primary_location?: {
    landing_page_url?: string | null;
  } | null;
}

/**
 * OpenAlex のレスポンスを Paper に変換する（テスト用に純粋関数として切り出し）
 */
export function toPaper(work: OpenAlexWork, requestedDoi: string): Paper | null {
  const rawTitle = work.title ?? work.display_name;
  if (!rawTitle) return null;

  const title = htmlToText(rawTitle);
  if (!title) return null;

  const doi = normalizeDoi(work.doi) ?? requestedDoi;

  const authors = (work.authorships ?? [])
    .map((authorship) =>
      normalizeText(authorship.author?.display_name ?? authorship.raw_author_name ?? "")
    )
    .filter((name) => name.length > 0);

  return {
    title,
    authors,
    summary: reconstructAbstract(work.abstract_inverted_index),
    link: work.primary_location?.landing_page_url ?? `https://doi.org/${doi}`,
    publishedYear: work.publication_year ?? null,
    doi,
    provider: "openalex",
  };
}

/**
 * 転置インデックスからアブストラクト本文を復元する
 *
 * 入力例: { "Deep": [0], "learning": [1, 7] }
 * 出力例: "Deep learning ..."
 */
export function reconstructAbstract(
  invertedIndex: Record<string, number[]> | null | undefined
): string {
  if (!invertedIndex) return "";

  const words: string[] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0) {
        words[position] = word;
      }
    }
  }

  // 欠番があっても落とさず詰めて結合する
  return normalizeText(words.filter((word) => word !== undefined).join(" "));
}
