import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperService } from "../src/services/paperService";
import { PaperFetchError, UnsupportedPaperUrlError } from "../src/utils/errors";

/**
 * どの論文 URL も「DOI に変換 -> 書誌 API」の一本道で処理されることを確認する
 */
describe("PaperService", () => {
  const OPENALEX_WORK = {
    doi: "https://doi.org/10.48550/arxiv.1706.03762",
    title: "Attention Is All You Need",
    publication_year: 2017,
    abstract_inverted_index: { The: [0], dominant: [1], models: [2] },
    authorships: [{ author: { display_name: "Ashish Vaswani" } }],
  };

  const CROSSREF_WORK = {
    message: {
      DOI: "10.1145/3292500.3330701",
      title: ["A Crossref Paper"],
      author: [{ given: "Ada", family: "Lovelace" }],
      abstract: "<jats:p>An abstract.</jats:p>",
      issued: { "date-parts": [[2019]] },
    },
  };

  const IEEE_PAGE = `<html><head>
    <meta name="citation_doi" content="10.1109/CVPR42600.2020.00975">
  </head><body></body></html>`;

  /** URL の部分一致でレスポンスを差し替える fetch スタブ。呼ばれた URL も記録する */
  function stubFetch(routes: Array<[string, () => Response]>): string[] {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      const route = routes.find(([fragment]) => url.includes(fragment));
      if (!route) throw new Error(`Unexpected fetch: ${url}`);
      return route[1]();
    });
    return calls;
  }

  const service = () => new PaperService({ CONTACT_EMAIL: undefined });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("turns an arXiv URL into its DataCite DOI without fetching the page", async () => {
    const calls = stubFetch([["api.openalex.org", () => Response.json(OPENALEX_WORK)]]);

    const paper = await service().fetchPaperByUrl("https://arxiv.org/abs/1706.03762");

    expect(paper).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani"],
      publishedYear: 2017,
      doi: "10.48550/arxiv.1706.03762",
      provider: "openalex",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("10.48550/arxiv.1706.03762");
  });

  it("keeps the URL the user pasted as the Notion link", async () => {
    stubFetch([["api.openalex.org", () => Response.json(OPENALEX_WORK)]]);

    const url = "https://arxiv.org/pdf/1706.03762v7.pdf";
    expect((await service().fetchPaperByUrl(url)).link).toBe(url);
  });

  it("reads the page only when the URL itself has no DOI", async () => {
    const calls = stubFetch([
      ["ieeexplore.ieee.org", () => new Response(IEEE_PAGE, { status: 200 })],
      ["api.openalex.org", () => Response.json(OPENALEX_WORK)],
    ]);

    await service().fetchPaperByUrl("https://ieeexplore.ieee.org/document/9156697");

    expect(calls[0]).toContain("ieeexplore.ieee.org");
    expect(calls[1]).toContain("10.1109/cvpr42600.2020.00975");
  });

  it("falls through to Crossref when OpenAlex has no record", async () => {
    stubFetch([
      ["api.openalex.org", () => new Response("not found", { status: 404 })],
      ["api.crossref.org", () => Response.json(CROSSREF_WORK)],
    ]);

    const paper = await service().fetchPaperByUrl("https://doi.org/10.1145/3292500.3330701");

    expect(paper).toMatchObject({ title: "A Crossref Paper", provider: "crossref" });
  });

  it("keeps going when a provider errors instead of failing the request", async () => {
    stubFetch([
      // 壊れた JSON を返す取得元。リトライしても直らない類の失敗
      ["api.openalex.org", () => new Response("<html>not json</html>", { status: 200 })],
      ["api.crossref.org", () => Response.json(CROSSREF_WORK)],
    ]);

    const paper = await service().fetchPaperByUrl("https://doi.org/10.1145/3292500.3330701");

    expect(paper.provider).toBe("crossref");
  });

  it("reports when no provider has the DOI", async () => {
    stubFetch([
      ["api.openalex.org", () => new Response("not found", { status: 404 })],
      ["api.crossref.org", () => new Response("not found", { status: 404 })],
    ]);

    await expect(
      service().fetchPaperByUrl("https://doi.org/10.1145/3292500.3330701")
    ).rejects.toThrow(PaperFetchError);
  });

  it("reports when the page has no DOI at all", async () => {
    stubFetch([["example.org", () => new Response("<html></html>", { status: 200 })]]);

    await expect(service().fetchPaperByUrl("https://example.org/paper")).rejects.toThrow(
      UnsupportedPaperUrlError
    );
  });

  it("suggests the DOI URL when the publisher blocks the page fetch", async () => {
    stubFetch([["ieeexplore.ieee.org", () => new Response("denied", { status: 403 })]]);

    await expect(
      service().fetchPaperByUrl("https://ieeexplore.ieee.org/document/9156697")
    ).rejects.toThrow(/https:\/\/doi\.org/);
  });
});
