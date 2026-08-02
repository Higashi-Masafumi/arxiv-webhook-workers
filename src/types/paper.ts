/**
 * 論文メタデータをどこから取得したか
 * - ieee-api:  IEEE Xplore Metadata API (要 API キー)
 * - ieee-html: IEEE Xplore の HTML ページ埋め込み JSON
 * - crossref:  Crossref REST API
 * - openalex:  OpenAlex API
 * - html-meta: 論文ページの citation_* / Dublin Core meta タグ
 */
export type PaperProvider =
  | "ieee-api"
  | "ieee-html"
  | "crossref"
  | "openalex"
  | "html-meta";

/**
 * 取得元に依存しない論文メタデータ
 */
export interface Paper {
  title: string;
  authors: string[];
  /** アブストラクト。取得できない場合は空文字列 */
  summary: string;
  /** Notion の Link プロパティに書き戻す正規 URL */
  link: string;
  /** 出版年。取得できない場合は null */
  publishedYear: number | null;
  /** DOI（取得できた場合のみ）。エンリッチメントの検索キーにも使う */
  doi?: string;
  provider: PaperProvider;
}
