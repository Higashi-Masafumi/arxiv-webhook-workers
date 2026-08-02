import { describe, expect, it } from "vitest";
import { htmlToText, normalizeText, stripAbstractLabel } from "../src/utils/html";

describe("htmlToText", () => {
  it("decodes named entities", () => {
    expect(htmlToText("a &amp; b &lt; c &gt; d &quot;e&quot;")).toBe('a & b < c > d "e"');
  });

  it("decodes decimal and hex numeric references", () => {
    expect(htmlToText("&#8212;&#x2014;&#956;")).toBe("——μ");
  });

  it("leaves unknown entities untouched", () => {
    expect(htmlToText("&notarealentity; &#xZZZZ;")).toBe("&notarealentity; &#xZZZZ;");
  });

  it("removes tags", () => {
    expect(htmlToText("<jats:p>Hello <b>world</b></jats:p>")).toBe("Hello world");
  });

  it("drops script and style contents entirely", () => {
    const html = "<p>keep</p><script>var a = 1;</script><style>.x{color:red}</style>";
    expect(htmlToText(html)).toBe("keep");
  });

  it("converts a Crossref JATS abstract to plain text", () => {
    const jats =
      "<jats:title>Abstract</jats:title><jats:p>We study <jats:italic>deep</jats:italic> nets &amp; more.</jats:p>";
    expect(htmlToText(jats)).toBe("Abstract We study deep nets & more.");
  });

  it("does not treat escaped angle brackets as tags", () => {
    // タグ除去 -> 実体参照デコード の順でないと本文の &lt;p&gt; が消えてしまう
    expect(htmlToText("<jats:p>use &lt;p&gt; tags</jats:p>")).toBe("use <p> tags");
  });
});

describe("stripAbstractLabel", () => {
  it.each([
    ["Abstract We propose a method.", "We propose a method."],
    ["ABSTRACT: We propose a method.", "We propose a method."],
    ["Abstract - We propose a method.", "We propose a method."],
    ["We propose a method.", "We propose a method."],
  ])("normalizes %s", (input, expected) => {
    expect(stripAbstractLabel(input)).toBe(expected);
  });
});
