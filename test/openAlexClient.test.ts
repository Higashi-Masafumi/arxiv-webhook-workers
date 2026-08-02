import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAlexClient, reconstructAbstract } from "../src/libs/openAlexClient";

describe("reconstructAbstract", () => {
  it("rebuilds text from an inverted index", () => {
    const invertedIndex = {
      Despite: [0],
      the: [1, 5],
      recent: [2],
      progress: [3],
      in: [4],
      field: [6],
    };
    expect(reconstructAbstract(invertedIndex)).toBe("Despite the recent progress in the field");
  });

  it("tolerates gaps in the position sequence", () => {
    expect(reconstructAbstract({ a: [0], c: [2] })).toBe("a c");
  });

  it.each([null, undefined, {}])("returns an empty string for %s", (input) => {
    expect(reconstructAbstract(input)).toBe("");
  });
});

describe("OpenAlexClient", () => {
  const fetchPaper = (work: unknown, doi = "10.1000/xyz") => {
    vi.stubGlobal("fetch", async () => Response.json(work));
    return new OpenAlexClient().fetchByDoi(doi);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a work including the reconstructed abstract", async () => {
    const work = {
      doi: "https://doi.org/10.1109/CVPR42600.2020.00975",
      title: "Momentum Contrast for Unsupervised Visual Representation Learning",
      publication_year: 2020,
      abstract_inverted_index: { We: [0], present: [1], MoCo: [2] },
      authorships: [{ author: { display_name: "Kaiming He" } }, { raw_author_name: "Haoqi Fan" }],
      primary_location: { landing_page_url: "https://ieeexplore.ieee.org/document/9156697" },
    };

    expect(await fetchPaper(work, "10.1109/cvpr42600.2020.00975")).toEqual({
      title: "Momentum Contrast for Unsupervised Visual Representation Learning",
      authors: ["Kaiming He", "Haoqi Fan"],
      summary: "We present MoCo",
      link: "https://ieeexplore.ieee.org/document/9156697",
      publishedYear: 2020,
      doi: "10.1109/cvpr42600.2020.00975",
      provider: "openalex",
    });
  });

  it("falls back to display_name and a DOI link", async () => {
    const paper = await fetchPaper({ display_name: "A Paper" });

    expect(paper?.title).toBe("A Paper");
    expect(paper?.link).toBe("https://doi.org/10.1000/xyz");
    expect(paper?.publishedYear).toBeNull();
  });

  it("returns null without a title", async () => {
    expect(await fetchPaper({ title: null, display_name: null })).toBeNull();
  });

  it("passes the contact email as the polite pool mailto", async () => {
    let requested = "";
    vi.stubGlobal("fetch", async (input: string | URL) => {
      requested = typeof input === "string" ? input : input.toString();
      return Response.json({ title: "A Paper" });
    });

    await new OpenAlexClient("dev@example.com").fetchByDoi("10.1000/xyz");

    expect(requested).toContain("mailto=dev%40example.com");
  });
});
