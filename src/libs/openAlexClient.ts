import type { Paper } from "../types/paper";
import { normalizeDoi } from "../utils/paperUrl";
import { DoiMetadataClient } from "./doiMetadataClient";

/**
 * OpenAlex API クライアント
 *
 * 主取得元。arXiv から商業出版社まで DOI を持つ文献をひと通り収録しており、
 * API キー不要・CC0 で使える。
 *
 * 著作権上の理由から abstract は「単語 -> 出現位置」の転置インデックスで返るため、
 * 復元処理が必要。
 *
 * @see https://docs.openalex.org/api-entities/works
 */
export class OpenAlexClient extends DoiMetadataClient<OpenAlexWork> {
  readonly name = "OpenAlex";

  protected endpoint(doi: string): string {
    const url = new URL(`https://api.openalex.org/works/doi:${doi}`);
    if (this.contactEmail) {
      url.searchParams.set("mailto", this.contactEmail);
    }
    return url.toString();
  }

  protected toPaper(work: OpenAlexWork, requestedDoi: string): Paper | null {
    const rawTitle = work.title ?? work.display_name;
    if (!rawTitle) return null;

    const title = this.toPlainText(rawTitle);
    if (!title) return null;

    const doi = normalizeDoi(work.doi) ?? requestedDoi;

    const authors = (work.authorships ?? [])
      .map((authorship) =>
        this.normalizeText(authorship.author?.display_name ?? authorship.raw_author_name ?? "")
      )
      .filter((name) => name.length > 0);

    return {
      title,
      authors,
      summary: this.normalizeText(reconstructAbstract(work.abstract_inverted_index)),
      link: work.primary_location?.landing_page_url ?? `https://doi.org/${doi}`,
      publishedYear: work.publication_year ?? null,
      doi,
      provider: "openalex",
    };
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
  return words.filter((word) => word !== undefined).join(" ");
}
