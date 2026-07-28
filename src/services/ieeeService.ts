import { fetchWithRetry, readTextCapped } from "../libs/httpClient";
import type { Paper } from "../types/paper";
import { parseCitationMeta } from "../utils/citationMeta";
import { parseEmbeddedJsonObject } from "../utils/embeddedJson";
import { PaperFetchError } from "../utils/errors";
import { htmlToText, normalizeText, stripAbstractLabel } from "../utils/html";
import { normalizeDoi } from "../utils/paperUrl";

/** IEEE Xplore のページで meta タグ / 埋め込み JSON を読むのに十分なサイズ */
const MAX_HTML_BYTES = 1_500_000;

/**
 * IEEE Xplore サービス
 *
 * IEEE の URL には DOI ではなく article number しか含まれないため、
 * Crossref に直接問い合わせることができない。次の順で取得を試みる。
 *
 * 1. IEEE Xplore Metadata API（`IEEE_API_KEY` がある場合）— 公式・最も確実
 * 2. 論文ページの HTML に埋め込まれた `xplGlobal.document.metadata` JSON
 * 3. 同ページの citation_* meta タグ
 *
 * 2 と 3 は IEEE 側の bot 対策で 403 になることがある。その場合は
 * DOI リンクを使うよう促すエラーを返す（DOI があれば Crossref 経路に乗る）。
 *
 * @see https://developer.ieee.org/docs
 */
export class IeeeService {
  private readonly METADATA_API_URL = "https://ieeexploreapi.ieee.org/api/v1/search/articles";
  private readonly XPLORE_DOCUMENT_URL = "https://ieeexplore.ieee.org/document";

  constructor(private readonly apiKey?: string) {}

  /**
   * article number（arnumber）から論文情報を取得する
   */
  async fetchByArticleNumber(articleNumber: string): Promise<Paper> {
    if (this.apiKey) {
      const paper = await this.fetchFromMetadataApi(articleNumber, this.apiKey);
      if (paper) return paper;
    }

    return await this.fetchFromDocumentPage(articleNumber);
  }

  /**
   * IEEE Xplore Metadata API から取得する
   */
  private async fetchFromMetadataApi(
    articleNumber: string,
    apiKey: string
  ): Promise<Paper | null> {
    const url = new URL(this.METADATA_API_URL);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("article_number", articleNumber);
    url.searchParams.set("format", "json");
    url.searchParams.set("max_records", "1");

    const response = await fetchWithRetry(url.toString(), {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      // API キーが失効していても HTML 経路で救える可能性があるので落とさず記録のみ
      console.warn(
        `[IEEE] Metadata API returned ${response.status} for article ${articleNumber}, falling back to HTML`
      );
      return null;
    }

    const body = (await response.json()) as IeeeApiResponse;
    const article = body.articles?.[0];
    if (!article) return null;

    return toPaperFromApi(article, articleNumber);
  }

  /**
   * Xplore の論文ページ HTML から取得する
   */
  private async fetchFromDocumentPage(articleNumber: string): Promise<Paper> {
    const documentUrl = `${this.XPLORE_DOCUMENT_URL}/${articleNumber}/`;

    let response: Response;
    try {
      response = await fetchWithRetry(documentUrl, {
        timeoutMs: 15000,
        headers: browserLikeHeaders(),
      });
    } catch (error) {
      throw new PaperFetchError(
        `Failed to reach IEEE Xplore for article ${articleNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (response.status === 403 || response.status === 401 || response.status === 429) {
      throw new PaperFetchError(
        `IEEE Xplore blocked the request for article ${articleNumber} (HTTP ${response.status}). ` +
          `Set IEEE_API_KEY to use the official Xplore Metadata API, or paste the paper's DOI URL (https://doi.org/...) instead.`,
        502
      );
    }

    if (!response.ok) {
      throw new PaperFetchError(
        `IEEE Xplore returned ${response.status} for article ${articleNumber}`
      );
    }

    const html = await readTextCapped(response, MAX_HTML_BYTES);
    const paper = parseXploreDocumentHtml(html, articleNumber);

    if (!paper) {
      throw new PaperFetchError(
        `Failed to parse IEEE Xplore page for article ${articleNumber}. ` +
          `Set IEEE_API_KEY to use the official Xplore Metadata API, or paste the paper's DOI URL (https://doi.org/...) instead.`
      );
    }

    return paper;
  }
}

/**
 * Xplore の論文ページ HTML から Paper を組み立てる（テスト用に純粋関数として切り出し）
 *
 * 埋め込み JSON を第一候補、citation_* meta タグを第二候補として、
 * フィールド単位で埋まっている方を採用する。
 */
export function parseXploreDocumentHtml(html: string, articleNumber: string): Paper | null {
  const metadata = parseEmbeddedJsonObject<XploreMetadata>(html, "xplGlobal.document.metadata");
  const meta = parseCitationMeta(html);

  const title = pickText(metadata?.title, meta.title);
  if (!title) return null;

  const authors = metadata?.authors?.length
    ? metadata.authors
        .map((author) => normalizeText(author.name ?? ""))
        .filter((name) => name.length > 0)
    : meta.authors;

  const abstract = pickText(metadata?.abstract, meta.abstract);
  const doi = normalizeDoi(metadata?.doi) ?? meta.doi;
  const year = parseNumericYear(metadata?.publicationYear) ?? meta.publishedYear ?? null;

  return {
    title,
    authors,
    summary: abstract ? stripAbstractLabel(abstract) : "",
    link: doi ? `https://doi.org/${doi}` : `https://ieeexplore.ieee.org/document/${articleNumber}`,
    publishedYear: year,
    doi,
    provider: "ieee-html",
  };
}

/**
 * Metadata API のレスポンスを Paper に変換する（テスト用に純粋関数として切り出し）
 */
export function toPaperFromApi(article: IeeeApiArticle, articleNumber: string): Paper | null {
  const title = article.title ? htmlToText(article.title) : "";
  if (!title) return null;

  const authors = (article.authors?.authors ?? [])
    .map((author) => normalizeText(author.full_name ?? ""))
    .filter((name) => name.length > 0);

  const doi = normalizeDoi(article.doi);

  return {
    title,
    authors,
    summary: article.abstract ? stripAbstractLabel(htmlToText(article.abstract)) : "",
    link:
      article.html_url ??
      (doi ? `https://doi.org/${doi}` : `https://ieeexplore.ieee.org/document/${articleNumber}`),
    publishedYear: parseNumericYear(article.publication_year),
    doi,
    provider: "ieee-api",
  };
}

/**
 * IEEE は bot 対策で User-Agent を見るため、ブラウザ相当のヘッダーを送る
 */
function browserLikeHeaders(): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

function pickText(...candidates: Array<string | undefined | null>): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const text = htmlToText(candidate);
    if (text.length > 0) return text;
  }
  return "";
}

function parseNumericYear(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const year = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(year) || year < 1800 || year > 2200) return null;
  return year;
}

/**
 * Xplore ページに埋め込まれた `xplGlobal.document.metadata` の必要部分
 */
interface XploreMetadata {
  title?: string;
  abstract?: string;
  doi?: string;
  publicationYear?: string;
  authors?: Array<{ name?: string }>;
}

interface IeeeApiResponse {
  articles?: IeeeApiArticle[];
}

export interface IeeeApiArticle {
  title?: string;
  abstract?: string;
  doi?: string;
  publication_year?: string;
  html_url?: string;
  authors?: {
    authors?: Array<{ full_name?: string }>;
  };
}
