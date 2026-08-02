import { CrossrefClient } from "../libs/crossrefClient";
import { DataCiteClient } from "../libs/dataCiteClient";
import { fetchDoiFromPage } from "../libs/doiFromPage";
import { OpenAlexClient } from "../libs/openAlexClient";
import type { Bindings } from "../types/bindings";
import type { DoiMetadataProvider, Paper } from "../types/paper";
import { PaperFetchError, UnsupportedPaperUrlError } from "../utils/errors";
import { resolveDoiFromUrl } from "../utils/paperUrl";

/**
 * 論文メタデータ取得
 *
 * 取得元ごとの分岐は持たない。どの論文 URL も次の一本道で処理する:
 *
 * ```
 * URL --(文字列だけで決まるか)--> DOI --> 書誌 API --> Paper
 *      \--(決まらなければページを1回見て DOI を探す)--/
 * ```
 *
 * arXiv も IEEE も出版社サイトも DOI という同じキーに落ちるため、
 * サイトごとのサービス・HTML パーサーを持つ必要がない。
 */
export class PaperService {
  private readonly providers: DoiMetadataProvider[];

  constructor(env: Pick<Bindings, "CONTACT_EMAIL">) {
    // 先に答えた取得元をそのまま使う（取得元をまたぐマージはしない）。
    //
    // DataCite を Crossref より先に置いているのは、この 2 つが排他的な登録機関で
    // 順序は空振りの回数にしか影響せず、主な入力である arXiv の DOI が
    // DataCite 側だから。OpenAlex は arXiv DOI での収録が歯抜けなので、
    // arXiv を DataCite 抜きで引くことはできない。
    this.providers = [
      new OpenAlexClient(env.CONTACT_EMAIL),
      new DataCiteClient(env.CONTACT_EMAIL),
      new CrossrefClient(env.CONTACT_EMAIL),
    ];
  }

  /**
   * 任意の論文 URL からメタデータを取得する
   */
  async fetchPaperByUrl(url: string): Promise<Paper> {
    const doi = await this.resolveDoi(url);

    for (const provider of this.providers) {
      const paper = await this.tryFetch(provider, doi);
      // Notion の Link プロパティはユーザーが入力した URL のままにする
      if (paper) return { ...paper, link: url };
    }

    throw new PaperFetchError(
      `No metadata found for ${doi} in ${this.providers.map((p) => p.name).join(" or ")}. ` +
        `Very recent papers can take a few days to be indexed.`
    );
  }

  /**
   * URL を DOI に変換する
   *
   * 文字列だけで決まらない場合に限りページを 1 回取得する。
   */
  private async resolveDoi(url: string): Promise<string> {
    const fromUrl = resolveDoiFromUrl(url);
    if (fromUrl) return fromUrl;

    let fromPage: string | undefined;
    try {
      fromPage = await fetchDoiFromPage(url);
    } catch (error) {
      throw new PaperFetchError(
        `Could not read ${url} to find its DOI: ${
          error instanceof Error ? error.message : String(error)
        }. Try pasting the paper's DOI URL (https://doi.org/...) instead.`
      );
    }

    if (!fromPage) {
      throw new UnsupportedPaperUrlError(
        `No DOI found for ${url}. ` +
          `Paste a URL that contains a DOI (https://doi.org/...) or an arXiv URL.`
      );
    }
    return fromPage;
  }

  /**
   * 1 つの取得元が落ちても次の取得元に進む
   */
  private async tryFetch(provider: DoiMetadataProvider, doi: string): Promise<Paper | null> {
    try {
      return await provider.fetchByDoi(doi);
    } catch (error) {
      console.warn(
        `[Paper] ${provider.name} lookup failed for ${doi}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
