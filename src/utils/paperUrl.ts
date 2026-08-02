/**
 * 論文 URL の解釈（純粋関数）
 *
 * このアプリは「どの論文 URL も DOI に変換し、DOI から書誌情報を引く」という
 * 一本道で動く。取得元ごとの分岐を持たないための唯一の共通キーが DOI。
 *
 * ここで扱うのは **ネットワークに出ずに DOI が決まる URL** だけ。
 * URL の形だけでは決まらない場合は `libs/doiFromPage.ts` がページを見に行く。
 */

/**
 * DOI の接頭辞（登録機関 ID）。接尾辞に使える文字は仕様上ほぼ無制限で、
 * `10.1002/(SICI)1099-0844(199912)17:4<290::AID-CBF849>3.0.CO;2-P` のように
 * 括弧・コロン・山括弧を含むものが実在するため、形を決められるのはここまで
 */
const DOI_PREFIX = /^10\.\d{4,9}\//;

/** 上記をパスの途中から探すための版 */
const DOI_PREFIX_ANYWHERE = /10\.\d{4,9}\//;

/**
 * 文中から DOI を拾うときの書式
 *
 * 上記のとおり接尾辞に使える文字は広いが、文中では終端が必要なので
 * 空白・引用符・山括弧・& ・# で切る。この文脈では `<` は DOI の一部ではなく
 * タグの開始とみなす方が当たる。
 */
const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s"'<>&#]+/;

/** arXiv の新形式 ID: 2301.12345 / 2301.12345v3 */
const ARXIV_NEW_ID = /^(\d{4}\.\d{4,5})(?:v\d+)?$/;

/** arXiv の旧形式 ID: cs/0112017, math.GT/0309136 */
const ARXIV_OLD_ID = /^([a-z-]+(?:\.[A-Za-z]{2})?\/\d{7})(?:v\d+)?$/;

/**
 * Nature 系の記事 slug は DOI 接尾辞そのもの
 * 例: /articles/s41586-021-03819-2 -> 10.1038/s41586-021-03819-2
 */
const NATURE_SLUG = /^\/articles\/([a-z0-9-]+)$/i;

/**
 * URL から DOI を求める。ネットワークに出ずに決まらなければ undefined
 *
 * 対応するのは次の 3 通り:
 *   1. URL そのものに DOI が含まれる（doi.org / ACM / Springer / Wiley ...）
 *   2. arXiv     — 投稿時に振られる DataCite DOI を ID から組み立てられる
 *   3. Nature 系 — 記事 slug が DOI 接尾辞と一致する
 *
 * 2 と 3 は「URL の文字列だけで DOI が確定する」という同じ理由で特例にしている。
 * 確定しないサイト（IEEE Xplore など）はページを取得して探す。
 */
export function resolveDoiFromUrl(rawUrl: string): string | undefined {
  const url = safeParseUrl(rawUrl);
  if (!url) return undefined;

  // arXiv 論文には投稿時に DataCite DOI が振られるので、ID から組み立てられる
  const arxivId = extractArxivIdOrNull(url);
  if (arxivId) return `10.48550/arxiv.${arxivId.toLowerCase()}`;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host.endsWith("nature.com")) {
    const slug = url.pathname.match(NATURE_SLUG);
    if (slug) return normalizeDoi(`10.1038/${slug[1]}`);
  }

  // クエリに DOI を持つサイト（?doi=...）
  const fromQuery = url.searchParams.get("doi");
  if (fromQuery) {
    const normalized = normalizeDoi(decodeURIComponent(fromQuery));
    if (normalized) return normalized;
  }

  // doi.org / ACM / Springer / Wiley などはパスに DOI がそのまま入る
  return doiFromPath(url.pathname);
}

/**
 * パスに埋め込まれた DOI を取り出す
 *
 * DOI の開始位置だけを探し、そこから先はパス末尾まで**そのまま**採る。
 * 接尾辞に含まれる括弧や山括弧を書式で切り落とさないため。
 */
function doiFromPath(pathname: string): string | undefined {
  const decoded = decodeURIComponent(pathname);
  const start = decoded.search(DOI_PREFIX_ANYWHERE);
  return start === -1 ? undefined : normalizeDoi(decoded.slice(start));
}

/**
 * arXiv URL / arXiv DOI から ID を取り出す。該当しなければ null
 *
 * 対応形式:
 *   https://arxiv.org/abs/2301.12345
 *   https://arxiv.org/abs/2301.12345v2
 *   https://arxiv.org/pdf/2301.12345.pdf
 *   https://arxiv.org/html/2301.12345v1
 *   https://arxiv.org/abs/cs/0112017      (旧形式)
 */
function extractArxivIdOrNull(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "arxiv.org" || host === "export.arxiv.org" || host === "browse.arxiv.org") {
    // /abs/<id> /pdf/<id> /html/<id> /format/<id> のいずれか。<id> はスラッシュを含みうる
    const path = url.pathname.replace(/^\/(abs|pdf|html|format)\//, "");
    if (path !== url.pathname) {
      return normalizeArxivId(path);
    }
  }

  return null;
}

/**
 * arXiv ID の末尾の `.pdf` とバージョン接尾辞を落として正規化する
 */
function normalizeArxivId(raw: string): string | null {
  const candidate = decodeURIComponent(raw)
    .replace(/\.pdf$/i, "")
    .replace(/\/$/, "");

  const newStyle = candidate.match(ARXIV_NEW_ID);
  if (newStyle) return newStyle[1];

  const oldStyle = candidate.match(ARXIV_OLD_ID);
  if (oldStyle) return oldStyle[1];

  return null;
}

/**
 * 文字列全体が DOI であるとみなして正規化する
 *
 * URL のパスや API レスポンスの DOI フィールドのように、DOI 以外が混ざらない
 * 文脈で使う。接尾辞は登録されたままの形を保つ（括弧・コロン・山括弧も DOI の
 * 一部になりうるので削らない）。
 *
 * DOI は大文字小文字を区別しないと仕様で定められているため、
 * 比較・キャッシュキーとして扱いやすいよう小文字に寄せる。
 */
export function normalizeDoi(value: string | undefined | null): string | undefined {
  if (!value) return undefined;

  const doi = value
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^info:doi\//i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    // URL 由来の末尾スラッシュは DOI の一部ではない
    .replace(/\/$/, "");

  return DOI_PREFIX.test(doi) ? doi.toLowerCase() : undefined;
}

/**
 * 文中から最初の DOI を拾う（HTML など、DOI 以外の文字列が周囲にある文脈）
 */
export function findDoiInText(text: string): string | undefined {
  const match = text.match(DOI_IN_TEXT);
  if (!match) return undefined;

  // 文末の句読点や閉じ括弧は DOI の一部ではないことが多い
  return normalizeDoi(match[0].replace(/[.,;:)\]}]+$/, ""));
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

/**
 * 内部ネットワーク向けと分かるホスト名の接尾辞
 * @see https://www.rfc-editor.org/rfc/rfc6761
 */
const INTERNAL_SUFFIXES = [".local", ".localhost", ".internal", ".home.arpa", ".test", ".invalid"];

/**
 * 取得しに行ってよい URL としてパースする
 *
 * 論文 URL は Notion のプロパティから来る、つまり外部入力なので、
 * そのまま fetch すると Worker が任意の宛先への GET 中継になってしまう。
 * 公開 Web 上の論文ページ以外は入口で弾く。
 *
 * 判定はホスト名の形だけで行う:
 *
 *   - **IP リテラルは一律拒否**。ループバック・リンクローカル・プライベート
 *     アドレスを個別に列挙する代わりにこうしている。論文ページが生の IP で
 *     配信されることはないので、これで実用上困らない。
 *     `http://2130706433/` のような難読化表記も URL パーサーが
 *     `127.0.0.1` に正規化するため、正規化後のホスト名を見れば足りる。
 *   - **ドットを含まないホスト名も拒否**（`localhost` / `intranet` など）
 *   - **内部向けの接尾辞**も拒否
 *
 * DNS リバインディング（公開名が内部アドレスに解決される）はこの層では
 * 防げないが、Workers の fetch はプライベートアドレスへ到達できないため
 * ここでは考慮しない。
 *
 * @throws {Error} 取得先として認められない URL の場合
 */
export function parsePublicHttpUrl(rawUrl: string): URL {
  const url = safeParseUrl(rawUrl);
  if (!url) {
    throw new Error(`Not a valid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${url.protocol}`);
  }

  const host = url.hostname.toLowerCase();

  // URL パーサーは IPv6 をブラケット付きで返す
  if (host.startsWith("[")) {
    throw new Error(`Refusing to fetch an IP address: ${url.hostname}`);
  }
  if (/^\d+(\.\d+)*$/.test(host)) {
    throw new Error(`Refusing to fetch an IP address: ${url.hostname}`);
  }
  if (!host.includes(".")) {
    throw new Error(`Refusing to fetch a non-public host: ${url.hostname}`);
  }
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new Error(`Refusing to fetch an internal host: ${url.hostname}`);
  }

  return url;
}
