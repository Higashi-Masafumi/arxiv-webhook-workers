import { decodeHtmlEntities, htmlToText, normalizeText, stripAbstractLabel } from "./html";
import { normalizeDoi } from "./paperUrl";

/**
 * 論文ページの <meta> タグから抽出したメタデータ
 *
 * 学術サイトの大半（ACM / Springer / Nature / ScienceDirect / Wiley / MDPI /
 * ACL Anthology / bioRxiv / PubMed など）は Highwire Press 形式の
 * `citation_*` meta タグを出力しており、サイトごとに CSS セレクタを
 * 書き分けるよりも遥かに安定して取得できる。
 * 取れないサイト向けに Dublin Core / OpenGraph もフォールバックとして見る。
 */
export interface CitationMeta {
  title?: string;
  authors: string[];
  abstract?: string;
  doi?: string;
  publishedYear?: number;
  canonicalUrl?: string;
}

interface MetaTag {
  name: string;
  content: string;
}

/**
 * <meta> タグを列挙する
 *
 * 属性値に `>` が含まれていても壊れないよう、クォート内を考慮して走査する
 * （abstract に "a > b" のような文字列が入ることが実際にある）
 */
export function extractMetaTags(html: string): MetaTag[] {
  const tags: MetaTag[] = [];
  const metaPattern = /<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/gi;

  for (const match of html.matchAll(metaPattern)) {
    const attributes = parseAttributes(match[1]);
    const name = attributes.name ?? attributes.property ?? attributes.itemprop;
    const content = attributes.content;
    if (!name || content === undefined) continue;
    tags.push({
      name: name.toLowerCase(),
      content: decodeHtmlEntities(content),
    });
  }

  return tags;
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

  for (const match of raw.matchAll(attributePattern)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attributes;
}

/**
 * HTML から citation_* / Dublin Core / OpenGraph メタデータを抽出する
 */
export function parseCitationMeta(html: string): CitationMeta {
  const tags = extractMetaTags(html);

  const all = (name: string): string[] =>
    tags.filter((tag) => tag.name === name).map((tag) => tag.content);
  const first = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = all(name).find((content) => content.trim().length > 0);
      if (value) return value;
    }
    return undefined;
  };

  const rawTitle = first("citation_title", "dc.title", "og:title", "twitter:title");
  const rawAbstract = first(
    "citation_abstract",
    "dc.description",
    "dcterms.abstract",
    "description",
    "og:description"
  );

  // citation_author は著者ごとに 1 タグ。無ければ DC / セミコロン区切りを見る
  let authors = [...all("citation_author"), ...all("dc.creator")]
    .flatMap(splitAuthorField)
    .map(normalizeAuthorName)
    .filter((name) => name.length > 0);
  if (authors.length === 0) {
    const authorsField = first("citation_authors", "author", "dc.contributor");
    if (authorsField) {
      authors = splitAuthorField(authorsField)
        .map(normalizeAuthorName)
        .filter((name) => name.length > 0);
    }
  }

  return {
    title: rawTitle ? htmlToText(rawTitle) : undefined,
    authors: dedupe(authors),
    abstract: rawAbstract ? stripAbstractLabel(htmlToText(rawAbstract)) : undefined,
    doi: normalizeDoi(first("citation_doi", "dc.identifier", "dcterms.identifier", "doi")),
    publishedYear: parseYear(
      first(
        "citation_publication_date",
        "citation_date",
        "citation_online_date",
        "citation_cover_date",
        "citation_year",
        "dc.date",
        "dcterms.issued",
        "article:published_time"
      )
    ),
    canonicalUrl: first(
      "citation_abstract_html_url",
      "citation_public_url",
      "og:url",
      "dc.identifier.uri"
    ),
  };
}

/**
 * "Doe, John; Roe, Jane" のようにまとめられた著者欄を分割する
 */
function splitAuthorField(value: string): string[] {
  return value
    .split(/\s*;\s*|\s+and\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * "Doe, John" 形式を "John Doe" に直す
 *
 * カンマが 1 つだけの場合のみ姓名の入れ替えとみなす。
 * カンマが複数ある欄は「複数著者が 1 タグに詰め込まれている」ケースなので触らない。
 */
function normalizeAuthorName(value: string): string {
  const name = normalizeText(value);
  const parts = name.split(",");
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return normalizeText(`${parts[1]} ${parts[0]}`);
  }
  return name;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * "2020/05/01" "2020-05-01" "2020" などから年を取り出す
 */
export function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{4})/);
  if (!match) return undefined;
  const year = Number.parseInt(match[1], 10);
  // 明らかに年ではない数値（DOI の一部など）を弾く
  if (year < 1800 || year > 2200) return undefined;
  return year;
}
