/**
 * HTML / XML 文字列を扱うためのユーティリティ
 *
 * Cloudflare Workers には BeautifulSoup のような DOM パーサーは無く、
 * 標準では HTMLRewriter（ストリーミング変換）しか使えない。
 * ここで必要なのは <head> の meta タグと JATS 由来のインラインタグの除去だけなので、
 * Workers / Node の双方でそのまま動く純粋関数として実装している。
 */

/** 名前付き実体参照のうち、論文メタデータで実際に出てくるものだけを扱う */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  times: "×",
  minus: "−",
  deg: "°",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  mu: "μ",
};

/**
 * HTML の実体参照をデコードする（数値参照 + 主要な名前付き参照）
 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#")) {
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
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * タグを除去する。<script> / <style> の中身は本文ではないので丸ごと捨てる
 */
export function stripTags(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
}

/**
 * 改行・連続空白を 1 つのスペースに畳む
 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * HTML / JATS 断片をプレーンテキストへ変換する
 *
 * Crossref の abstract は JATS XML（`<jats:p>...</jats:p>`）で返ってくるため、
 * タグ除去 → 実体参照デコード → 空白正規化 の順に適用する。
 * （逆順にすると本文中の `&lt;` がタグとして誤除去される）
 */
export function htmlToText(html: string): string {
  return normalizeText(decodeHtmlEntities(stripTags(html)));
}

/**
 * アブストラクト先頭に付く "Abstract" ラベルを取り除く
 * （JATS の `<jats:title>Abstract</jats:title>` 由来）
 */
export function stripAbstractLabel(text: string): string {
  return text.replace(/^\s*abstract[:.\s—-]*/i, "").trim();
}
