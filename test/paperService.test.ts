import { afterEach, describe, expect, it, vi } from "vitest";
import { PaperService, mergePapers, needsEnrichment } from "../src/services/paperService";
import type { Paper } from "../src/types/paper";
import { PaperFetchError } from "../src/utils/errors";

const base: Paper = {
  title: "A Paper",
  authors: ["Ada Lovelace"],
  summary: "An abstract.",
  link: "https://ieeexplore.ieee.org/document/1",
  publishedYear: 2020,
  doi: "10.1109/x",
  provider: "ieee-html",
};

describe("needsEnrichment", () => {
  it("is false when every field is populated", () => {
    expect(needsEnrichment(base)).toBe(false);
  });

  it.each([
    ["missing abstract", { summary: "" }],
    ["missing authors", { authors: [] }],
    ["missing year", { publishedYear: null }],
  ])("is true for a paper %s", (_label, patch) => {
    expect(needsEnrichment({ ...base, ...patch })).toBe(true);
  });
});

describe("mergePapers", () => {
  it("fills only the gaps and keeps the primary title and link", () => {
    const incomplete: Paper = {
      ...base,
      summary: "",
      authors: [],
      publishedYear: null,
    };
    const supplement: Paper = {
      title: "A Paper (Crossref spelling)",
      authors: ["Ada Lovelace", "Charles Babbage"],
      summary: "The Crossref abstract.",
      link: "https://doi.org/10.1109/x",
      publishedYear: 2019,
      doi: "10.1109/x",
      provider: "crossref",
    };

    expect(mergePapers(incomplete, supplement)).toEqual({
      title: "A Paper",
      authors: ["Ada Lovelace", "Charles Babbage"],
      summary: "The Crossref abstract.",
      link: "https://ieeexplore.ieee.org/document/1",
      publishedYear: 2019,
      doi: "10.1109/x",
      provider: "ieee-html",
    });
  });

  it("does not overwrite fields the primary source already provided", () => {
    const supplement: Paper = {
      ...base,
      title: "Other",
      authors: ["Someone Else"],
      summary: "Other abstract",
      publishedYear: 1999,
      provider: "openalex",
    };
    expect(mergePapers(base, supplement)).toEqual(base);
  });

  it("adopts a DOI discovered by the supplement", () => {
    const withoutDoi: Paper = { ...base, doi: undefined };
    expect(mergePapers(withoutDoi, base).doi).toBe("10.1109/x");
  });
});

/**
 * arXiv 論文は arXiv DOI をキーに OpenAlex から引く
 * （arXiv 公式 API は Workers の IP を遮断するため使わない）
 */
describe("PaperService: arXiv papers are fetched through OpenAlex", () => {
  const ARXIV_URL = "https://arxiv.org/abs/1706.03762";
  const ABS_URL = "https://arxiv.org/abs/1706.03762";
  const DOI = "10.48550/arxiv.1706.03762";

  const OPENALEX_WORK = {
    doi: `https://doi.org/${DOI}`,
    title: "Attention Is All You Need",
    publication_year: 2017,
    abstract_inverted_index: { The: [0], dominant: [1], models: [2] },
    authorships: [{ author: { display_name: "Ashish Vaswani" } }],
    primary_location: { landing_page_url: "https://www.semanticscholar.org/paper/xyz" },
  };

  const ABS_PAGE_HTML = `<html><head>
    <meta name="citation_title" content="Attention Is All You Need">
    <meta name="citation_author" content="Vaswani, Ashish">
    <meta name="citation_date" content="2017/06/12">
    <meta name="citation_abstract" content="The dominant sequence transduction models.">
  </head><body></body></html>`;

  /** URL の部分一致でレスポンスを差し替える fetch スタブ */
  function stubFetch(routes: Array<[string, () => Response]>): void {
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const route = routes.find(([fragment]) => url.includes(fragment));
      if (!route) throw new Error(`Unexpected fetch: ${url}`);
      return route[1]();
    });
  }

  const service = () => new PaperService({ IEEE_API_KEY: undefined, CONTACT_EMAIL: undefined });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the arXiv DOI through OpenAlex and keeps the arXiv link", async () => {
    stubFetch([["api.openalex.org", () => Response.json(OPENALEX_WORK)]]);

    const paper = await service().fetchPaperByUrl(ARXIV_URL);

    expect(paper).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani"],
      summary: "The dominant models",
      link: ABS_URL,
      publishedYear: 2017,
      doi: DOI,
      provider: "openalex",
    });
  });

  it("never calls the arXiv API", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      seen.push(url);
      if (url.includes("api.openalex.org")) return Response.json(OPENALEX_WORK);
      throw new Error(`Unexpected fetch: ${url}`);
    });

    await service().fetchPaperByUrl(ARXIV_URL);

    expect(seen.some((url) => url.includes("export.arxiv.org"))).toBe(false);
  });

  it("falls back to the abs page when OpenAlex has no record yet", async () => {
    stubFetch([
      ["api.openalex.org", () => new Response("not found", { status: 404 })],
      ["arxiv.org/abs/", () => new Response(ABS_PAGE_HTML, { status: 200 })],
    ]);

    const paper = await service().fetchPaperByUrl(ARXIV_URL);

    expect(paper).toMatchObject({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani"],
      summary: "The dominant sequence transduction models.",
      publishedYear: 2017,
      doi: DOI,
      provider: "html-meta",
    });
  });

  it("reports both attempted routes when every route fails", async () => {
    stubFetch([
      ["api.openalex.org", () => new Response("not found", { status: 404 })],
      ["arxiv.org/abs/", () => new Response("blocked", { status: 403 })],
    ]);

    await expect(service().fetchPaperByUrl(ARXIV_URL)).rejects.toThrow(PaperFetchError);
    await expect(service().fetchPaperByUrl(ARXIV_URL)).rejects.toThrow(
      /OpenAlex or https:\/\/arxiv\.org\/abs\//
    );
  });

  it("resolves an arXiv DOI URL through the same route", async () => {
    stubFetch([["api.openalex.org", () => Response.json(OPENALEX_WORK)]]);

    const paper = await service().fetchPaperByUrl(`https://doi.org/${DOI}`);

    expect(paper).toMatchObject({ link: ABS_URL, doi: DOI, provider: "openalex" });
  });
});
