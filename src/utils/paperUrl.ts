import { ValidationError } from "./errors";

/**
 * URL から判定した取得ルート
 */
export type PaperUrlTarget =
  | { kind: "arxiv"; arxivId: string }
  | { kind: "ieee"; articleNumber: string }
  | { kind: "doi"; doi: string; sourceUrl: string }
  | { kind: "generic"; sourceUrl: string };

/**
 * DOI 本体の書式。接尾辞に使える文字は広いので、URL / 引用文で終端になりがちな
 * 記号（空白・引用符・山括弧・& ・#）だけを除外する
 */
const DOI_PATTERN = /10\.\d{4,9}\/[^\s"'<>&#]+/;

/** arXiv の新形式 ID: 2301.12345 / 2301.12345v3 */
const ARXIV_NEW_ID = /^(\d{4}\.\d{4,5})(?:v\d+)?$/;

/** arXiv の旧形式 ID: cs/0112017, math.GT/0309136 */
const ARXIV_OLD_ID = /^([a-z-]+(?:\.[A-Za-z]{2})?\/\d{7})(?:v\d+)?$/;

/** arXiv の DataCite DOI: 10.48550/arXiv.2301.12345 */
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;

/**
 * Nature 系の記事 slug は DOI 接尾辞そのもの
 * 例: /articles/s41586-021-03819-2 -> 10.1038/s41586-021-03819-2
 */
const NATURE_SLUG = /^\/articles\/([a-z0-9-]+)$/i;

/**
 * URL を解析して、どの取得ルートを使うか決める
 *
 * @throws {ValidationError} URL として解釈できない場合
 */
export function detectPaperUrl(rawUrl: string): PaperUrlTarget {
  const url = parseHttpUrl(rawUrl);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const href = url.href;

  // 1. arXiv: 専用 API があり最も情報が正確なので最優先
  const arxivId = extractArxivIdOrNull(href);
  if (arxivId) {
    return { kind: "arxiv", arxivId };
  }

  // 2. IEEE Xplore: URL には DOI ではなく article number しか含まれない
  if (host === "ieeexplore.ieee.org") {
    const articleNumber = extractIeeeArticleNumber(url);
    if (articleNumber) {
      return { kind: "ieee", articleNumber };
    }
  }

  // 3. URL から DOI が直接取れるサイト（doi.org / ACM / Springer / Wiley / Nature ...）
  const doi = extractDoiFromUrl(url);
  if (doi) {
    return { kind: "doi", doi, sourceUrl: href };
  }

  // 4. それ以外はページの meta タグに賭ける
  return { kind: "generic", sourceUrl: href };
}

/**
 * http(s) URL としてパースする
 */
export function parseHttpUrl(rawUrl: string): URL {
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
export function extractArxivIdOrNull(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "arxiv.org" || host === "export.arxiv.org" || host === "browse.arxiv.org") {
    // /abs/<id> /pdf/<id> /html/<id> /format/<id> のいずれか。<id> はスラッシュを含みうる
    const path = url.pathname.replace(/^\/(abs|pdf|html|format)\//, "");
    if (path !== url.pathname) {
      return normalizeArxivId(path);
    }
  }

  // arXiv 論文の DOI 形式も arXiv API で引ける
  const doi = extractDoiFromUrl(url);
  const arxivDoi = doi?.match(ARXIV_DOI);
  if (arxivDoi) {
    return normalizeArxivId(arxivDoi[1]);
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
 * IEEE Xplore の article number（arnumber）を取り出す
 *
 * 対応形式:
 *   https://ieeexplore.ieee.org/document/9156697
 *   https://ieeexplore.ieee.org/abstract/document/9156697/
 *   https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=9156697
 *   https://ieeexplore.ieee.org/xpl/articleDetails.jsp?arnumber=9156697
 */
export function extractIeeeArticleNumber(url: URL): string | null {
  const fromPath = url.pathname.match(/\/document\/(\d+)/);
  if (fromPath) return fromPath[1];

  const fromQuery = url.searchParams.get("arnumber") ?? url.searchParams.get("articleNumber");
  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;

  return null;
}

/**
 * URL から DOI を取り出す。該当しなければ undefined
 */
export function extractDoiFromUrl(input: URL | string): string | undefined {
  const url = typeof input === "string" ? safeParseUrl(input) : input;
  if (!url) return undefined;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  // doi.org / dx.doi.org はパス全体が DOI
  if (host === "doi.org" || host === "dx.doi.org") {
    return normalizeDoi(decodeURIComponent(url.pathname.replace(/^\//, "")));
  }

  // Nature 系は記事 slug が DOI 接尾辞と一致する
  if (host.endsWith("nature.com")) {
    const slug = url.pathname.match(NATURE_SLUG);
    if (slug) return normalizeDoi(`10.1038/${slug[1]}`);
  }

  // ACM / Springer / Wiley / Taylor & Francis などはパスに DOI がそのまま入る。
  // クエリに DOI を持つサイト（?doi=...）にも対応する
  const fromQuery = url.searchParams.get("doi");
  if (fromQuery) {
    const normalized = normalizeDoi(decodeURIComponent(fromQuery));
    if (normalized) return normalized;
  }

  return normalizeDoi(decodeURIComponent(url.pathname));
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
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
 * 論文 URL として受け付けられるか
 *
 * generic フォールバックがある以上「http(s) URL であればひとまず受ける」が方針。
 * 実際に取得できるかは各プロバイダの応答で判断する。
 */
export function validatePaperUrl(url: string): boolean {
  try {
    parseHttpUrl(url);
    return true;
  } catch {
    return false;
  }
}
