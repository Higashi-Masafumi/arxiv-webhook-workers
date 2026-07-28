import { describe, expect, it } from "vitest";
import {
  detectPaperUrl,
  extractArxivIdOrNull,
  extractDoiFromUrl,
  normalizeDoi,
  validatePaperUrl,
} from "../src/utils/paperUrl";
import { ValidationError } from "../src/utils/errors";

describe("extractArxivIdOrNull", () => {
  it.each([
    ["https://arxiv.org/abs/2301.12345", "2301.12345"],
    ["https://arxiv.org/abs/2301.12345v2", "2301.12345"],
    ["http://arxiv.org/abs/1706.03762", "1706.03762"],
    ["https://www.arxiv.org/abs/1706.03762", "1706.03762"],
    ["https://arxiv.org/pdf/2301.12345.pdf", "2301.12345"],
    ["https://arxiv.org/pdf/2301.12345v3.pdf", "2301.12345"],
    ["https://arxiv.org/html/2301.12345v1", "2301.12345"],
    ["https://arxiv.org/abs/2301.1234", "2301.1234"],
    ["https://export.arxiv.org/abs/2301.12345", "2301.12345"],
    // 2007 年以前の旧形式 ID
    ["https://arxiv.org/abs/cs/0112017", "cs/0112017"],
    ["https://arxiv.org/abs/math.GT/0309136", "math.GT/0309136"],
    ["https://arxiv.org/abs/hep-th/9901001v2", "hep-th/9901001"],
    // arXiv の DataCite DOI
    ["https://doi.org/10.48550/arXiv.2301.12345", "2301.12345"],
  ])("parses %s", (url, expected) => {
    expect(extractArxivIdOrNull(url)).toBe(expected);
  });

  it.each([
    "https://ieeexplore.ieee.org/document/9156697",
    "https://arxiv.org/list/cs.CL/2301",
    "https://example.com/abs/2301.12345",
    "not a url",
  ])("returns null for %s", (url) => {
    expect(extractArxivIdOrNull(url)).toBeNull();
  });
});

describe("normalizeDoi", () => {
  it.each([
    ["10.1109/CVPR42600.2020.00975", "10.1109/cvpr42600.2020.00975"],
    ["doi:10.1145/3292500.3330701", "10.1145/3292500.3330701"],
    ["DOI: 10.1145/3292500.3330701", "10.1145/3292500.3330701"],
    ["https://doi.org/10.1038/s41586-021-03819-2", "10.1038/s41586-021-03819-2"],
    ["info:doi/10.1007/s11263-019-01228-7", "10.1007/s11263-019-01228-7"],
    // 文末の句読点は DOI の一部ではない
    ["see 10.1145/3292500.3330701.", "10.1145/3292500.3330701"],
    ["/doi/10.1145/3292500.3330701/", "10.1145/3292500.3330701"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeDoi(input)).toBe(expected);
  });

  it.each([undefined, null, "", "no doi here", "10.1/short"])(
    "returns undefined for %s",
    (input) => {
      expect(normalizeDoi(input)).toBeUndefined();
    }
  );
});

describe("extractDoiFromUrl", () => {
  it.each([
    ["https://doi.org/10.1109/TPAMI.2019.2913372", "10.1109/tpami.2019.2913372"],
    ["https://dx.doi.org/10.1109/TPAMI.2019.2913372", "10.1109/tpami.2019.2913372"],
    ["https://dl.acm.org/doi/10.1145/3292500.3330701", "10.1145/3292500.3330701"],
    ["https://dl.acm.org/doi/abs/10.1145/3292500.3330701", "10.1145/3292500.3330701"],
    [
      "https://link.springer.com/article/10.1007/s11263-019-01228-7",
      "10.1007/s11263-019-01228-7",
    ],
    [
      "https://onlinelibrary.wiley.com/doi/10.1002/aisy.202000148",
      "10.1002/aisy.202000148",
    ],
    // Nature の記事 slug は DOI 接尾辞と一致する
    ["https://www.nature.com/articles/s41586-021-03819-2", "10.1038/s41586-021-03819-2"],
    ["https://www.nature.com/articles/nature12373", "10.1038/nature12373"],
    // クエリ文字列に入っている場合
    ["https://example.org/landing?doi=10.1145/3292500.3330701", "10.1145/3292500.3330701"],
  ])("extracts DOI from %s", (url, expected) => {
    expect(extractDoiFromUrl(url)).toBe(expected);
  });

  it.each([
    "https://www.sciencedirect.com/science/article/pii/S0004370221000862",
    "https://openreview.net/forum?id=Bkg6RiCqY7",
    "https://aclanthology.org/N19-1423/",
  ])("returns undefined for %s", (url) => {
    expect(extractDoiFromUrl(url)).toBeUndefined();
  });
});

describe("detectPaperUrl", () => {
  it("routes arXiv URLs to the arXiv API", () => {
    expect(detectPaperUrl("https://arxiv.org/abs/1706.03762")).toEqual({
      kind: "arxiv",
      arxivId: "1706.03762",
    });
  });

  it.each([
    ["https://ieeexplore.ieee.org/document/9156697", "9156697"],
    ["https://ieeexplore.ieee.org/abstract/document/9156697/", "9156697"],
    ["https://ieeexplore.ieee.org/document/9156697/?arnumber=9156697", "9156697"],
    ["https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=9156697", "9156697"],
    ["https://ieeexplore.ieee.org/xpl/articleDetails.jsp?arnumber=9156697", "9156697"],
  ])("routes IEEE URL %s to the IEEE provider", (url, articleNumber) => {
    expect(detectPaperUrl(url)).toEqual({ kind: "ieee", articleNumber });
  });

  it("routes DOI-bearing URLs to the DOI provider", () => {
    expect(detectPaperUrl("https://dl.acm.org/doi/10.1145/3292500.3330701")).toEqual({
      kind: "doi",
      doi: "10.1145/3292500.3330701",
      sourceUrl: "https://dl.acm.org/doi/10.1145/3292500.3330701",
    });
  });

  it("falls back to generic scraping when no identifier is present", () => {
    const url = "https://aclanthology.org/N19-1423/";
    expect(detectPaperUrl(url)).toEqual({ kind: "generic", sourceUrl: url });
  });

  it.each(["not a url", "ftp://example.com/paper.pdf", "javascript:alert(1)"])(
    "rejects %s",
    (url) => {
      expect(() => detectPaperUrl(url)).toThrow(ValidationError);
    }
  );
});

describe("validatePaperUrl", () => {
  it("accepts any http(s) URL", () => {
    expect(validatePaperUrl("https://example.com/paper")).toBe(true);
    expect(validatePaperUrl("http://example.com/paper")).toBe(true);
  });

  it("rejects non-http(s) input", () => {
    expect(validatePaperUrl("mailto:a@b.com")).toBe(false);
    expect(validatePaperUrl("")).toBe(false);
  });
});
