import { normalizeDoi, parsePublicHttpUrl } from "../utils/paperUrl";
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

/** 出版社サイトは http -> https や正規 URL への転送を挟むので、数回は追う */
const MAX_REDIRECTS = 5;

/**
 * ページを取得して DOI を探す。見つからなければ undefined
 *
 * 転送先も外部入力と同じ扱いなので、自動追従させず 1 ホップずつ検査する。
 * そうしないと「公開ページ -> 内部アドレス」の転送で入口の検査を回避できてしまう。
 *
 * @throws {Error} 取得先として認められない / ページ取得に失敗した場合
 */
export async function fetchDoiFromPage(pageUrl: string): Promise<string | undefined> {
  let target = parsePublicHttpUrl(pageUrl);

  for (let hop = 0; ; hop++) {
    const response = await fetchWithRetry(target.toString(), {
      timeoutMs: TIMEOUT_MS,
      headers: { ...BROWSER_HEADERS },
      redirect: "manual",
    });

    const location = isRedirect(response.status) ? response.headers.get("location") : null;
    if (!location) {
      if (!response.ok) {
        throw new Error(
          `${target} returned ${response.status}` +
            (response.status === 403 ? " (the publisher is blocking automated access)" : "")
        );
      }
      return findDoi(await readTextCapped(response, MAX_HTML_BYTES));
    }

    if (hop >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects while fetching ${pageUrl}`);
    }
    // 相対 Location を解決したうえで、転送先も同じ基準で検査する
    target = parsePublicHttpUrl(new URL(location, target).toString());
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
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
