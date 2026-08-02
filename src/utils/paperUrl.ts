import { ValidationError } from "./errors";

/**
 * 論文 URL から DOI を求める（純粋関数）
 *
 * このアプリは「どの論文 URL も DOI に変換し、DOI から書誌情報を引く」という
 * 一本道で動く。取得元ごとの分岐を持たないための唯一の共通キーが DOI。
 *
 * ここで扱うのは **ネットワークに出ずに DOI が決まる URL** だけ。
 * URL の形だけでは決まらない場合は `libs/doiFromPage.ts` がページを見に行く。
 */

/**
 * DOI 本体の書式。接尾辞に使える文字は広いので、URL / 引用文で終端になりがちな
 * 記号（空白・引用符・山括弧・& ・#）だけを除外する
 */
const DOI_PATTERN = /10\.\d{4,9}\/[^\s"'<>&#]+/;

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

  // doi.org / dx.doi.org はパス全体が DOI
  if (host === "doi.org" || host === "dx.doi.org") {
    return normalizeDoi(decodeURIComponent(url.pathname.replace(/^\//, "")));
  }

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

  // ACM / Springer / Wiley / Taylor & Francis などはパスに DOI がそのまま入る
  return normalizeDoi(decodeURIComponent(url.pathname));
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
 *   https://doi.org/10.48550/arXiv.2301.12345
 */
function extractArxivIdOrNull(input: URL | string): string | null {
  const url = typeof input === "string" ? safeParseUrl(input) : input;
  if (!url) return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "arxiv.org" || host === "export.arxiv.org" || host === "browse.arxiv.org") {
    // /abs/<id> /pdf/<id> /html/<id> /format/<id> のいずれか。<id> はスラッシュを含みうる
    const path = url.pathname.replace(/^\/(abs|pdf|html|format)\//, "");
    if (path !== url.pathname) {
      return normalizeArxivId(path);
    }
  }

  // 既に arXiv DOI の形で渡された場合も ID に戻す（正規化のため）
  if (host === "doi.org" || host === "dx.doi.org") {
    const doi = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const match = doi.match(/^10\.48550\/arxiv\.(.+)$/i);
    if (match) return normalizeArxivId(match[1]);
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
 * DOI 文字列を正規化する（プレフィックス除去・末尾の句読点除去・小文字化）
 *
 * DOI は大文字小文字を区別しないと仕様で定められているため、
 * 比較・キャッシュキーとして扱いやすいよう小文字に寄せる。
 */
export function normalizeDoi(value: string | undefined | null): string | undefined {
  if (!value) return undefined;

  const withoutPrefix = value
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^info:doi\//i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");

  const match = withoutPrefix.match(DOI_PATTERN);
  if (!match) return undefined;

  // 文末の句読点や URL の末尾スラッシュは DOI の一部ではないことが多い
  const doi = match[0].replace(/[.,;:)\]}/]+$/, "");
  return doi.length > 0 ? doi.toLowerCase() : undefined;
}

/**
 * http(s) URL としてパースする
 */
function parseHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new ValidationError(`Invalid URL: ${rawUrl}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError(`Unsupported URL scheme: ${url.protocol}`);
  }
  return url;
}

/**
 * 論文 URL として受け付けられるか
 *
 * DOI が取れるかは実際に引いてみるまで分からないので、ここでは形式だけ見る。
 */
export function validatePaperUrl(url: string): boolean {
  try {
    parseHttpUrl(url);
    return true;
  } catch {
    return false;
  }
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}
