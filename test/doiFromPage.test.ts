import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDoiFromPage, findDoi } from "../src/libs/doiFromPage";

describe("findDoi", () => {
  it.each([
    [
      "citation_doi meta tag",
      `<meta name="citation_doi" content="10.1145/3292500.3330701">`,
      "10.1145/3292500.3330701",
    ],
    [
      "content before name",
      `<meta content="10.1145/3292500.3330701" name="citation_doi">`,
      "10.1145/3292500.3330701",
    ],
    [
      "Dublin Core identifier",
      `<meta name="DC.Identifier" content="doi:10.1007/s11263-019-01228-7">`,
      "10.1007/s11263-019-01228-7",
    ],
    [
      "embedded JSON (IEEE xplGlobal)",
      `<script>xplGlobal.document.metadata={"doi":"10.1109/CVPR42600.2020.00975","title":"x"}</script>`,
      "10.1109/cvpr42600.2020.00975",
    ],
    [
      "bare DOI in the body",
      `<p>https://doi.org/10.1038/s41586-021-03819-2</p>`,
      "10.1038/s41586-021-03819-2",
    ],
  ])("finds the DOI in %s", (_label, html, expected) => {
    expect(findDoi(html)).toBe(expected);
  });

  it("prefers the paper's own DOI over one in the reference list", () => {
    const html = `<html><head>
      <meta name="citation_doi" content="10.1145/3292500.3330701">
    </head><body>
      <ol class="references"><li>Someone et al. 10.1109/OTHER.2019.123</li></ol>
    </body></html>`;

    expect(findDoi(html)).toBe("10.1145/3292500.3330701");
  });

  it("returns undefined when the page has no DOI", () => {
    expect(findDoi("<html><head><title>No DOI here</title></head></html>")).toBeUndefined();
  });
});

/**
 * 転送先も外部入力なので、1 ホップずつ検査していることを確認する
 */
describe("fetchDoiFromPage redirects", () => {
  const PAGE = `<meta name="citation_doi" content="10.1145/3292500.3330701">`;

  /** URL ごとの応答を引くスタブ。呼ばれた URL を記録する */
  function stubFetch(routes: Record<string, () => Response>): string[] {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      const respond = routes[url];
      if (!respond) throw new Error(`Unexpected fetch: ${url}`);
      return respond();
    });
    return calls;
  }

  const redirectTo = (location: string) =>
    new Response(null, { status: 302, headers: { location } });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows a redirect to another public page", async () => {
    const calls = stubFetch({
      "http://dl.acm.org/doi/x": () => redirectTo("https://dl.acm.org/doi/x"),
      "https://dl.acm.org/doi/x": () => new Response(PAGE, { status: 200 }),
    });

    expect(await fetchDoiFromPage("http://dl.acm.org/doi/x")).toBe("10.1145/3292500.3330701");
    expect(calls).toHaveLength(2);
  });

  it("resolves a relative Location against the current URL", async () => {
    stubFetch({
      "https://example.org/a": () => redirectTo("/b"),
      "https://example.org/b": () => new Response(PAGE, { status: 200 }),
    });

    expect(await fetchDoiFromPage("https://example.org/a")).toBe("10.1145/3292500.3330701");
  });

  it("refuses a redirect that points at a private address", async () => {
    const calls = stubFetch({
      "https://example.org/a": () => redirectTo("http://169.254.169.254/latest/meta-data/"),
    });

    await expect(fetchDoiFromPage("https://example.org/a")).rejects.toThrow(
      /Refusing to fetch an IP address/
    );
    // 転送先は取得していない
    expect(calls).toEqual(["https://example.org/a"]);
  });

  it("refuses the initial URL when it is not public", async () => {
    const calls = stubFetch({});

    await expect(fetchDoiFromPage("http://localhost/paper")).rejects.toThrow(
      /Refusing to fetch a non-public host/
    );
    expect(calls).toEqual([]);
  });

  it("gives up after too many redirects", async () => {
    stubFetch({ "https://example.org/loop": () => redirectTo("https://example.org/loop") });

    await expect(fetchDoiFromPage("https://example.org/loop")).rejects.toThrow(
      /Too many redirects/
    );
  });
});
