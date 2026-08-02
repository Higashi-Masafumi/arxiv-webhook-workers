import { describe, expect, it } from "vitest";
import { normalizeDoi, parsePublicHttpUrl, resolveDoiFromUrl } from "../src/utils/paperUrl";

describe("resolveDoiFromUrl: arXiv", () => {
  it.each([
    ["https://arxiv.org/abs/2301.12345", "10.48550/arxiv.2301.12345"],
    ["https://arxiv.org/abs/2301.12345v2", "10.48550/arxiv.2301.12345"],
    ["http://arxiv.org/abs/1706.03762", "10.48550/arxiv.1706.03762"],
    ["https://www.arxiv.org/abs/1706.03762", "10.48550/arxiv.1706.03762"],
    ["https://arxiv.org/pdf/2301.12345.pdf", "10.48550/arxiv.2301.12345"],
    ["https://arxiv.org/pdf/2301.12345v3.pdf", "10.48550/arxiv.2301.12345"],
    ["https://arxiv.org/html/2301.12345v1", "10.48550/arxiv.2301.12345"],
    ["https://export.arxiv.org/abs/2301.12345", "10.48550/arxiv.2301.12345"],
    // 2007 年以前の旧形式 ID
    ["https://arxiv.org/abs/cs/0112017", "10.48550/arxiv.cs/0112017"],
    ["https://arxiv.org/abs/math.GT/0309136", "10.48550/arxiv.math.gt/0309136"],
    ["https://arxiv.org/abs/hep-th/9901001v2", "10.48550/arxiv.hep-th/9901001"],
    // arXiv DOI で渡された場合もバージョン接尾辞を落として正規化する
    ["https://doi.org/10.48550/arXiv.2301.12345", "10.48550/arxiv.2301.12345"],
  ])("builds the DataCite DOI for %s", (url, expected) => {
    expect(resolveDoiFromUrl(url)).toBe(expected);
  });

  it("is not fooled by arXiv-looking paths on other hosts", () => {
    expect(resolveDoiFromUrl("https://example.com/abs/2301.12345")).toBeUndefined();
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

describe("resolveDoiFromUrl", () => {
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
    expect(resolveDoiFromUrl(url)).toBe(expected);
  });

  it.each([
    "https://www.sciencedirect.com/science/article/pii/S0004370221000862",
    "https://openreview.net/forum?id=Bkg6RiCqY7",
    "https://aclanthology.org/N19-1423/",
    // IEEE の URL には article number しか入っていない（ページを見に行く）
    "https://ieeexplore.ieee.org/document/9156697",
    "https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=9156697",
    "not a url",
  ])("returns undefined for %s", (url) => {
    expect(resolveDoiFromUrl(url)).toBeUndefined();
  });
});

describe("parsePublicHttpUrl", () => {
  it.each([
    "https://arxiv.org/abs/1706.03762",
    "http://dl.acm.org/doi/10.1145/3292500.3330701",
    "https://ieeexplore.ieee.org/document/9156697",
  ])("accepts the public paper URL %s", (url) => {
    expect(parsePublicHttpUrl(url).toString()).toBe(new URL(url).toString());
  });

  it.each([
    // ループバック・リンクローカル・プライベートアドレス
    ["loopback", "http://127.0.0.1/paper"],
    ["all-zeros", "http://0.0.0.0/paper"],
    ["link-local (cloud metadata)", "http://169.254.169.254/latest/meta-data/"],
    ["private class A", "http://10.0.0.1/paper"],
    ["private class B", "http://172.16.0.1/paper"],
    ["private class C", "http://192.168.0.1/paper"],
    // 難読化された表記も URL パーサーが正規化するので同じ扱いになる
    ["decimal-encoded loopback", "http://2130706433/paper"],
    ["hex-encoded loopback", "http://0x7f.1/paper"],
    ["octal-encoded address", "http://010.0.0.1/paper"],
    // IPv6
    ["IPv6 loopback", "http://[::1]/paper"],
    ["IPv6 unique local", "http://[fd00::1]/paper"],
    ["IPv4-mapped IPv6", "http://[::ffff:127.0.0.1]/paper"],
    // ドットを含まない / 内部向けの名前
    ["localhost", "http://localhost/paper"],
    ["bare hostname", "http://intranet/paper"],
    ["mDNS name", "http://printer.local/paper"],
    ["internal suffix", "https://wiki.internal/paper"],
    // http(s) 以外
    ["file scheme", "file:///etc/passwd"],
    ["data scheme", "data:text/html,<meta name=citation_doi content=10.1/x>"],
    ["not a URL", "just some text"],
  ])("rejects %s", (_label, url) => {
    expect(() => parsePublicHttpUrl(url)).toThrow();
  });
});
