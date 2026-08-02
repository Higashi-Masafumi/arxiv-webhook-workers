import type { Paper } from "../types/paper";
import { normalizeDoi } from "../utils/paperUrl";
import { DoiMetadataClient } from "./doiMetadataClient";

/**
 * Crossref REST API クライアント
 *
 * ACM / Springer / Elsevier / Wiley など、DOI を発行している出版社の書誌情報を
 * 横断的に引ける。abstract は出版社が Crossref に登録している場合のみ返る。
 * OpenAlex に収録されていない DOI を拾うための副取得元。
 *
 * @see https://api.crossref.org/swagger-ui/index.html
 */
export class CrossrefClient extends DoiMetadataClient<CrossrefResponse> {
  readonly name = "Crossref";

  protected endpoint(doi: string): string {
    return `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  }

  protected toPaper(response: CrossrefResponse, requestedDoi: string): Paper | null {
    const work = response.message;
    if (!work) return null;

    const title = work.title?.map((part) => this.toPlainText(part)).find((part) => part.length > 0);
    if (!title) return null;

    const doi = normalizeDoi(work.DOI) ?? requestedDoi;

    return {
      title,
      authors: this.parseAuthors(work.author),
      // Crossref の abstract は JATS XML なのでタグを落とす
      summary: work.abstract ? this.stripAbstractLabel(this.toPlainText(work.abstract)) : "",
      link: work.URL ?? `https://doi.org/${doi}`,
      publishedYear: parsePublishedYear(work),
      doi,
      provider: "crossref",
    };
  }

  private parseAuthors(authors: CrossrefWork["author"]): string[] {
    if (!authors) return [];

    return authors
      .map((author) => {
        // 団体著者は name のみを持つ
        if (author.name) return this.normalizeText(author.name);
        return this.normalizeText([author.given, author.family].filter(Boolean).join(" "));
      })
      .filter((name) => name.length > 0);
  }
}

interface CrossrefResponse {
  message?: CrossrefWork;
}

interface CrossrefWork {
  DOI?: string;
  URL?: string;
  title?: string[];
  abstract?: string;
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
  }>;
  published?: CrossrefDate;
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
  issued?: CrossrefDate;
  created?: CrossrefDate;
}

interface CrossrefDate {
  "date-parts"?: number[][];
}

/**
 * 出版年を取り出す
 *
 * Crossref は published / published-print / published-online / issued に
 * バラバラに日付を入れてくるので、確度の高い順に見る
 */
function parsePublishedYear(work: CrossrefWork): number | null {
  const candidates: Array<CrossrefDate | undefined> = [
    work.published,
    work.issued,
    work["published-print"],
    work["published-online"],
    work.created,
  ];

  for (const candidate of candidates) {
    const year = candidate?.["date-parts"]?.[0]?.[0];
    if (typeof year === "number" && year >= 1800 && year <= 2200) {
      return year;
    }
  }

  return null;
}
