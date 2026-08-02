import { CrossrefClient } from "../libs/crossrefClient";
import { fetchWithRetry, readTextCapped } from "../libs/httpClient";
import { OpenAlexClient } from "../libs/openAlexClient";
import type { Bindings } from "../types/bindings";
import type { Paper } from "../types/paper";
import { IeeeService } from "./ieeeService";
import { parseCitationMeta } from "../utils/citationMeta";
import { PaperFetchError, UnsupportedPaperUrlError } from "../utils/errors";
import { arxivAbsUrl, arxivDoi, detectPaperUrl } from "../utils/paperUrl";

/** meta タグは <head> にあるので、全文を読み込む必要はない */
const MAX_HTML_BYTES = 1_000_000;

/**
 * 論文メタデータ取得のオーケストレーター
 *
 * URL の形から取得ルートを選び、足りないフィールド（特にアブストラクト）を
 * 別ソースで補完する。
 *
 * ```
 * arxiv.org/abs/...          -> OpenAlex (arXiv DOI 経由) -> abs ページ
 * ieeexplore.ieee.org/...    -> IEEE Xplore Metadata API / ページ埋め込み JSON
 * URL から DOI が取れる       -> Crossref -> (abstract 欠落時) OpenAlex
 * それ以外                    -> ページの citation_* meta タグ -> (DOI があれば) Crossref/OpenAlex
 * ```
 */
export class PaperService {
  private readonly ieeeService: IeeeService;
  private readonly crossrefClient: CrossrefClient;
  private readonly openAlexClient: OpenAlexClient;

  constructor(env: Pick<Bindings, "IEEE_API_KEY" | "CONTACT_EMAIL">) {
    this.ieeeService = new IeeeService(env.IEEE_API_KEY);
    this.crossrefClient = new CrossrefClient(env.CONTACT_EMAIL);
    this.openAlexClient = new OpenAlexClient(env.CONTACT_EMAIL);
  }

  /**
   * 任意の論文 URL からメタデータを取得する
   */
  async fetchPaperByUrl(url: string): Promise<Paper> {
    const target = detectPaperUrl(url);

    switch (target.kind) {
      case "arxiv":
        return await this.fetchArxiv(target.arxivId);

      case "ieee":
        return await this.enrich(await this.ieeeService.fetchByArticleNumber(target.articleNumber));

      case "doi":
        return await this.fetchByDoi(target.doi, target.sourceUrl);

      case "generic":
        return await this.fetchFromWebPage(target.sourceUrl);
    }
  }

  /**
   * arXiv 論文を OpenAlex から取得する
   *
   * arXiv 公式 API (export.arxiv.org) は使わない。クラウド事業者の IP からの
   * 自動アクセスをまとめて遮断することがあり、その間 403 が返り続けて
   * リトライでも回復しないため。arXiv 論文には投稿時に DataCite DOI
   * (`10.48550/arXiv.xxxx`) が振られるので、それをキーに OpenAlex から引く。
   */
  private async fetchArxiv(arxivId: string): Promise<Paper> {
    const doi = arxivDoi(arxivId);
    const absUrl = arxivAbsUrl(arxivId);

    // arXiv DOI は DataCite 登録で Crossref には無いため、OpenAlex を直接引く
    const openAlex = await this.tryFetch("OpenAlex", () => this.openAlexClient.fetchByDoi(doi));
    if (openAlex) {
      // Notion に載せるリンクは OpenAlex の landing page ではなく arXiv を指す
      return { ...openAlex, link: absUrl };
    }

    // OpenAlex への収録は投稿から数日遅れることがあるので、abs ページに退避する
    console.warn(`[Paper] No OpenAlex record for ${doi}, falling back to ${absUrl}`);
    try {
      return await this.fetchFromWebPage(absUrl, doi);
    } catch (error) {
      throw new PaperFetchError(
        `Could not fetch arXiv:${arxivId} from OpenAlex or ${absUrl}. ` +
          `(last error: ${error instanceof Error ? error.message : String(error)})`
      );
    }
  }

  /**
   * DOI から取得する。Crossref を主、OpenAlex を副とし、
   * どちらも駄目なら元ページの meta タグに落とす
   */
  private async fetchByDoi(doi: string, sourceUrl: string): Promise<Paper> {
    const crossref = await this.tryFetch("Crossref", () => this.crossrefClient.fetchByDoi(doi));
    if (crossref) {
      return await this.enrich(crossref);
    }

    const openAlex = await this.tryFetch("OpenAlex", () => this.openAlexClient.fetchByDoi(doi));
    if (openAlex) return openAlex;

    console.warn(`[Paper] No DOI metadata for ${doi}, falling back to page scraping`);
    return await this.fetchFromWebPage(sourceUrl, doi);
  }

  /**
   * 論文ページの citation_* meta タグから取得する
   *
   * ACM / Springer / ScienceDirect / Wiley / MDPI / ACL Anthology / bioRxiv など
   * Highwire Press 形式の meta タグを出しているサイトはこれで拾える。
   */
  private async fetchFromWebPage(sourceUrl: string, knownDoi?: string): Promise<Paper> {
    let response: Response;
    try {
      response = await fetchWithRetry(sourceUrl, {
        timeoutMs: 15000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch (error) {
      throw new PaperFetchError(
        `Failed to fetch ${sourceUrl}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      throw new PaperFetchError(
        `Paper page returned ${response.status} for ${sourceUrl}. ` +
          `The publisher may be blocking automated access — try pasting the DOI URL (https://doi.org/...) instead.`
      );
    }

    const html = await readTextCapped(response, MAX_HTML_BYTES);
    const meta = parseCitationMeta(html);

    if (!meta.title) {
      throw new UnsupportedPaperUrlError(
        `Could not extract paper metadata from ${sourceUrl}. ` +
          `Supported: arXiv, IEEE Xplore, and any page exposing a DOI or citation_* meta tags.`
      );
    }

    const paper: Paper = {
      title: meta.title,
      authors: meta.authors,
      summary: meta.abstract ?? "",
      link: meta.canonicalUrl ?? sourceUrl,
      publishedYear: meta.publishedYear ?? null,
      doi: meta.doi ?? knownDoi,
      provider: "html-meta",
    };

    // meta タグから新たに DOI が判明した場合のみ、DOI 経路で補完する。
    // knownDoi は fetchByDoi 側で既に試行済みなので再問い合わせしない
    if (meta.doi && meta.doi !== knownDoi) {
      return await this.enrich(paper);
    }

    return paper;
  }

  /**
   * 欠けているアブストラクト・著者・出版年を DOI ベースの API で補完する
   *
   * IEEE は Crossref に abstract を登録していないことが多く、
   * 逆に OpenAlex は abstract を持っていることが多い、といった差を吸収する。
   */
  private async enrich(paper: Paper): Promise<Paper> {
    if (!paper.doi || !needsEnrichment(paper)) return paper;

    const candidates: Array<[string, () => Promise<Paper | null>]> = [];
    if (paper.provider !== "crossref") {
      candidates.push(["Crossref", () => this.crossrefClient.fetchByDoi(paper.doi!)]);
    }
    if (paper.provider !== "openalex") {
      candidates.push(["OpenAlex", () => this.openAlexClient.fetchByDoi(paper.doi!)]);
    }

    let merged = paper;
    for (const [name, fetchCandidate] of candidates) {
      const supplement = await this.tryFetch(name, fetchCandidate);
      if (supplement) {
        merged = mergePapers(merged, supplement);
      }
      if (!needsEnrichment(merged)) break;
    }

    return merged;
  }

  /**
   * 補完目的の取得は、失敗しても本体の取得結果を捨てない
   */
  private async tryFetch(
    providerName: string,
    fetchPaper: () => Promise<Paper | null>
  ): Promise<Paper | null> {
    try {
      return await fetchPaper();
    } catch (error) {
      console.warn(
        `[Paper] ${providerName} lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}

/**
 * 補完が必要か（アブストラクト・著者・出版年のいずれかが欠けている）
 */
export function needsEnrichment(paper: Paper): boolean {
  return paper.summary.length === 0 || paper.authors.length === 0 || paper.publishedYear === null;
}

/**
 * base に欠けているフィールドだけを supplement から埋める
 *
 * title と link は base（URL から直接特定できた取得元）を優先する
 */
export function mergePapers(base: Paper, supplement: Paper): Paper {
  return {
    ...base,
    summary: base.summary || supplement.summary,
    authors: base.authors.length > 0 ? base.authors : supplement.authors,
    publishedYear: base.publishedYear ?? supplement.publishedYear,
    doi: base.doi ?? supplement.doi,
  };
}
