import type { Paper } from "../types/paper";
import { htmlToText, normalizeText, stripAbstractLabel } from "../utils/html";
import { normalizeDoi } from "../utils/paperUrl";
import { fetchWithRetry } from "./httpClient";

/**
 * Crossref REST API クライアント
 *
 * IEEE / ACM / Springer / Elsevier / Wiley など、DOI を発行している出版社の
 * 書誌情報を横断的に引ける。abstract は出版社が Crossref に登録している場合のみ
 * 返るため（IEEE は未登録が多い）、取れなければ OpenAlex にフォールバックする。
 *
 * @see https://api.crossref.org/swagger-ui/index.html
 */
export class CrossrefClient {
  private readonly API_BASE_URL = "https://api.crossref.org/works";

  /**
   * @param contactEmail Crossref の "polite pool" 用連絡先。指定するとレート制限が緩和される
   * @see https://api.crossref.org/swagger-ui/index.html#/Etiquette
   */
  constructor(private readonly contactEmail?: string) {}

  /**
   * DOI から書誌情報を取得する。見つからなければ null
   */
  async fetchByDoi(doi: string): Promise<Paper | null> {
    const url = `${this.API_BASE_URL}/${encodeURIComponent(doi)}`;

    const response = await fetchWithRetry(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent(),
      },
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Crossref API returned ${response.status}`);
    }

    const body = (await response.json()) as { message?: CrossrefWork };
    if (!body.message) return null;

    return toPaper(body.message, doi);
  }

  private userAgent(): string {
    const base = "arxiv-webhook-workers (https://github.com/Higashi-Masafumi/arxiv-webhook-workers";
    return this.contactEmail ? `${base}; mailto:${this.contactEmail})` : `${base})`;
  }
}

interface CrossrefWork {
  DOI?: string;
  URL?: string;
  title?: string[];
  "container-title"?: string[];
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
 * Crossref のレスポンスを Paper に変換する（テスト用に純粋関数として切り出し）
 */
export function toPaper(work: CrossrefWork, requestedDoi: string): Paper | null {
  const title = work.title?.map((part) => htmlToText(part)).find((part) => part.length > 0);
  if (!title) return null;

  const doi = normalizeDoi(work.DOI) ?? requestedDoi;

  return {
    title,
    authors: parseAuthors(work.author),
    // Crossref の abstract は JATS XML なのでタグを落とす
    summary: work.abstract ? stripAbstractLabel(htmlToText(work.abstract)) : "",
    link: work.URL ?? `https://doi.org/${doi}`,
    publishedYear: parsePublishedYear(work),
    doi,
    provider: "crossref",
  };
}

function parseAuthors(authors: CrossrefWork["author"]): string[] {
  if (!authors) return [];

  return authors
    .map((author) => {
      // 団体著者は name のみを持つ
      if (author.name) return normalizeText(author.name);
      return normalizeText([author.given, author.family].filter(Boolean).join(" "));
    })
    .filter((name) => name.length > 0);
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
