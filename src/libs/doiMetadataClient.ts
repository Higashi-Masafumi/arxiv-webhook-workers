import type { DoiMetadataProvider, Paper } from "../types/paper";
import { fetchWithRetry } from "./httpClient";

/**
 * DOI を投げると書誌情報が返る API のクライアント基底クラス
 *
 * Crossref も OpenAlex も「DOI で 1 件引く」「無ければ 404」「polite pool 用に
 * 連絡先を名乗る」という形が同じなので、違うのは
 * **エンドポイントの組み立て方**と**レスポンスの読み方**だけ。
 * その 2 つだけを派生クラスに実装させる。
 *
 * @typeParam TResponse この API が返す JSON の型
 */
export abstract class DoiMetadataClient<TResponse> implements DoiMetadataProvider {
  abstract readonly name: string;

  /**
   * @param contactEmail Crossref / OpenAlex の "polite pool" 用連絡先。
   *   指定するとレート制限が緩和され、障害時に連絡が来る
   */
  constructor(protected readonly contactEmail?: string) {}

  /** DOI 1 件を引くための URL */
  protected abstract endpoint(doi: string): string;

  /** レスポンスを Paper に変換する。論文として成立しない場合は null */
  protected abstract toPaper(response: TResponse, requestedDoi: string): Paper | null;

  /**
   * DOI から書誌情報を取得する。収録されていなければ null
   *
   * @throws {Error} 通信に失敗した / API がエラーを返した場合
   */
  async fetchByDoi(doi: string): Promise<Paper | null> {
    const response = await fetchWithRetry(this.endpoint(doi), {
      headers: {
        Accept: "application/json",
        "User-Agent": this.userAgent(),
      },
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`${this.name} API returned ${response.status}`);
    }

    return this.toPaper((await response.json()) as TResponse, doi);
  }

  private userAgent(): string {
    const base = "arxiv-webhook-workers (https://github.com/Higashi-Masafumi/arxiv-webhook-workers";
    return this.contactEmail ? `${base}; mailto:${this.contactEmail})` : `${base})`;
  }

  /**
   * 改行・連続空白を 1 つのスペースに畳む
   */
  protected normalizeText(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  /**
   * API が返すマークアップを落としてプレーンテキストにする
   *
   * ページのスクレイピング用ではない。Crossref のアブストラクトは JATS XML
   * (`<jats:p>...</jats:p>`)、タイトルは実体参照混じりで返ってくるため、
   * そのまま Notion に書くとタグが見えてしまう。
   *
   * タグ除去 -> 実体参照デコード の順に適用する
   * （逆順にすると本文中の `&lt;` がタグとして誤除去される）
   */
  protected toPlainText(markup: string): string {
    const withoutTags = markup
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]*>/g, " ");
    return this.normalizeText(decodeEntities(withoutTags));
  }

  /**
   * アブストラクト先頭に付く "Abstract" ラベルを取り除く
   * （JATS の `<jats:title>Abstract</jats:title>` 由来）
   */
  protected stripAbstractLabel(text: string): string {
    return text.replace(/^\s*abstract[:.\s—-]*/i, "").trim();
  }
}

/** XML の定義済み実体。これ以外の記号は数値参照で送られてくる */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (!body.startsWith("#")) {
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    }

    const isHex = body[1] === "x" || body[1] === "X";
    const codePoint = isHex
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
      return match;
    }
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  });
}
