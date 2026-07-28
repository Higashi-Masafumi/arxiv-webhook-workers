import { describe, expect, it } from "vitest";
import { extractMetaTags, parseCitationMeta, parseYear } from "../src/utils/citationMeta";

/** Highwire Press 形式の meta タグを出す一般的な出版社ページ（ACM 相当） */
const ACM_LIKE_HTML = `<!DOCTYPE html>
<html><head>
<meta name="citation_title" content="KGAT: Knowledge Graph Attention Network for Recommendation">
<meta name="citation_author" content="Wang, Xiang">
<meta name="citation_author" content="He, Xiangnan">
<meta name="citation_author" content="Cao, Yixin">
<meta name="citation_publication_date" content="2019/07/25">
<meta name="citation_doi" content="10.1145/3292500.3330701">
<meta name="citation_abstract" content="To provide more accurate recommendation, we propose &amp;quot;KGAT&amp;quot;.">
<meta name="citation_abstract_html_url" content="https://dl.acm.org/doi/10.1145/3292500.3330701">
<meta property="og:title" content="Should be ignored in favour of citation_title">
</head><body></body></html>`;

describe("extractMetaTags", () => {
  it("reads name, property and itemprop attributes", () => {
    const html = `<meta name="a" content="1"><meta property="og:b" content="2"><meta itemprop="c" content="3">`;
    expect(extractMetaTags(html)).toEqual([
      { name: "a", content: "1" },
      { name: "og:b", content: "2" },
      { name: "c", content: "3" },
    ]);
  });

  it("handles single quotes, attribute reordering and self-closing tags", () => {
    const html = `<meta content='1' name='a' /><meta CONTENT="2" NAME="B">`;
    expect(extractMetaTags(html)).toEqual([
      { name: "a", content: "1" },
      { name: "b", content: "2" },
    ]);
  });

  it("does not break when the content value contains '>'", () => {
    const html = `<meta name="citation_abstract" content="we show a > b holds"><meta name="citation_title" content="T">`;
    expect(extractMetaTags(html)).toEqual([
      { name: "citation_abstract", content: "we show a > b holds" },
      { name: "citation_title", content: "T" },
    ]);
  });

  it("skips meta tags without a name or content", () => {
    const html = `<meta charset="utf-8"><meta name="a"><meta content="orphan">`;
    expect(extractMetaTags(html)).toEqual([]);
  });
});

describe("parseCitationMeta", () => {
  it("parses a Highwire Press style page", () => {
    expect(parseCitationMeta(ACM_LIKE_HTML)).toEqual({
      title: "KGAT: Knowledge Graph Attention Network for Recommendation",
      // "Family, Given" は "Given Family" に直す
      authors: ["Xiang Wang", "Xiangnan He", "Yixin Cao"],
      abstract: 'To provide more accurate recommendation, we propose "KGAT".',
      doi: "10.1145/3292500.3330701",
      publishedYear: 2019,
      canonicalUrl: "https://dl.acm.org/doi/10.1145/3292500.3330701",
    });
  });

  it("falls back to Dublin Core and OpenGraph", () => {
    const html = `<head>
      <meta name="DC.Title" content="A Dublin Core Paper">
      <meta name="DC.Creator" content="Ada Lovelace">
      <meta name="DC.Creator" content="Alan Turing">
      <meta name="DC.Date" content="1936-05-28">
      <meta name="DC.Identifier" content="doi:10.1000/xyz123">
      <meta property="og:description" content="Abstract: On computable numbers.">
    </head>`;

    expect(parseCitationMeta(html)).toEqual({
      title: "A Dublin Core Paper",
      authors: ["Ada Lovelace", "Alan Turing"],
      abstract: "On computable numbers.",
      doi: "10.1000/xyz123",
      publishedYear: 1936,
      canonicalUrl: undefined,
    });
  });

  it("splits semicolon-separated author fields", () => {
    const html = `<meta name="citation_title" content="T">
      <meta name="citation_authors" content="Doe, John; Roe, Jane; ACME Research Group">`;
    expect(parseCitationMeta(html).authors).toEqual([
      "John Doe",
      "Jane Roe",
      "ACME Research Group",
    ]);
  });

  it("de-duplicates repeated authors", () => {
    const html = `<meta name="citation_author" content="Ada Lovelace">
      <meta name="citation_author" content="Ada Lovelace">`;
    expect(parseCitationMeta(html).authors).toEqual(["Ada Lovelace"]);
  });

  it("returns an empty result for a page with no scholarly metadata", () => {
    expect(parseCitationMeta("<html><head><title>Nope</title></head></html>")).toEqual({
      title: undefined,
      authors: [],
      abstract: undefined,
      doi: undefined,
      publishedYear: undefined,
      canonicalUrl: undefined,
    });
  });
});

describe("parseYear", () => {
  it.each([
    ["2019/07/25", 2019],
    ["2019-07-25", 2019],
    ["2019", 2019],
    ["Jul 2019", 2019],
  ])("parses %s", (input, expected) => {
    expect(parseYear(input)).toBe(expected);
  });

  it.each([undefined, "", "no digits", "12", "9999999"])(
    "returns undefined for %s",
    (input) => {
      expect(parseYear(input)).toBeUndefined();
    }
  );
});
