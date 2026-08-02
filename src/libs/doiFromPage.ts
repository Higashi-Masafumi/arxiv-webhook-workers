import { normalizeDoi } from "../utils/paperUrl";
import { fetchWithRetry, readTextCapped } from "./httpClient";

/**
 * 論文ページから DOI だけを拾う
 *
 * このアプリで HTML を触るのはここだけ。書誌情報そのものは DOI から
 * 書誌 API で引くので、ページから取りたいのは DOI 1 つに限られる。
 * 「サイトごとにタイトル・著者・アブストラクトをスクレイピングする」形にすると
 * 出版社の数だけパーサーが増えるため、そこには踏み込まない。
 */

/** DOI は <head> 付近にあるので、全文を読み込む必要はない */
const MAX_HTML_BYTES = 1_000_000;

const TIMEOUT_MS = 15000;

/**
 * ブラウザを装う。学術サイトの多くは既定の UA を弾く
 */
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

/**
 * DOI が書かれていそうな場所を、確実な順に見る
 *
 * 素の `10.xxxx/...` を先に拾うと参考文献リストの DOI を掴みうるので、
 * 「この論文自身の DOI」だと分かる書き方を優先する。
 */
const DOI_SOURCES: Array<(html: string) => string | undefined> = [
  // Highwire Press / Dublin Core の meta タグ。属性の順序は問わないので、
  // 該当する meta タグを 1 つ切り出してから content を読む
  (html) =>
    html
      .match(/<meta[^>]*\b(?:name|property)=["'](?:citation_doi|dc\.identifier|doi)["'][^>]*>/i)?.[0]
      ?.match(/content=["']([^"']+)["']/i)?.[1],
  // ページに埋め込まれた JSON（IEEE Xplore の xplGlobal など）
  (html) => html.match(/"doi"\s*:\s*"(10\.[^"]+)"/i)?.[1],
  // 最後の手段として本文中の最初の DOI（normalizeDoi が先頭一致で拾う）
  (html) => html,
];

/**
 * ページを 1 回取得して DOI を探す。見つからなければ undefined
 *
 * @throws {Error} ページ取得自体に失敗した場合（403 の bot 対策など）
 */
export async function fetchDoiFromPage(pageUrl: string): Promise<string | undefined> {
  const response = await fetchWithRetry(pageUrl, {
    timeoutMs: TIMEOUT_MS,
    headers: { ...BROWSER_HEADERS },
  });

  if (!response.ok) {
    throw new Error(
      `${pageUrl} returned ${response.status}` +
        (response.status === 403 ? " (the publisher is blocking automated access)" : "")
    );
  }

  return findDoi(await readTextCapped(response, MAX_HTML_BYTES));
}

/**
 * HTML から DOI を取り出す（テスト用に純粋関数として切り出し）
 */
export function findDoi(html: string): string | undefined {
  for (const findIn of DOI_SOURCES) {
    const doi = normalizeDoi(findIn(html));
    if (doi) return doi;
  }
  return undefined;
}
