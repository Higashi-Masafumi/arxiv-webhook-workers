import { afterEach, describe, expect, it, vi } from "vitest";
import { DataCiteClient } from "../src/libs/dataCiteClient";

/** 実際の api.datacite.org/dois/10.48550/arxiv.1706.03762 のレスポンスを模したもの */
const ARXIV_RECORD = {
  data: {
    attributes: {
      doi: "10.48550/arxiv.1706.03762",
      url: "https://arxiv.org/abs/1706.03762",
      titles: [{ title: "Attention Is All You Need" }],
      publicationYear: 2017,
      creators: [
        { name: "Vaswani, Ashish", nameType: "Personal", givenName: "Ashish", familyName: "Vaswani" },
        { name: "Shazeer, Noam", nameType: "Personal", givenName: "Noam", familyName: "Shazeer" },
      ],
      descriptions: [
        { description: "The dominant sequence transduction models.", descriptionType: "Abstract" },
        { description: "Comment: 15 pages", descriptionType: "Other" },
      ],
    },
  },
};

describe("DataCiteClient", () => {
  const fetchPaper = (body: unknown, doi = "10.48550/arxiv.1706.03762") => {
    vi.stubGlobal("fetch", async () => Response.json(body));
    return new DataCiteClient().fetchByDoi(doi);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps an arXiv record", async () => {
    expect(await fetchPaper(ARXIV_RECORD)).toEqual({
      title: "Attention Is All You Need",
      // name は "Vaswani, Ashish" の順なので given/family から組み立てる
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      summary: "The dominant sequence transduction models.",
      link: "https://arxiv.org/abs/1706.03762",
      publishedYear: 2017,
      doi: "10.48550/arxiv.1706.03762",
      provider: "datacite",
    });
  });

  it("picks the Abstract description and ignores the others", async () => {
    const paper = await fetchPaper(ARXIV_RECORD);
    expect(paper?.summary).not.toContain("Comment");
  });

  it("leaves the summary empty when there is no abstract", async () => {
    const record = {
      data: {
        attributes: { ...ARXIV_RECORD.data.attributes, descriptions: [{ description: "x", descriptionType: "Other" }] },
      },
    };
    expect((await fetchPaper(record))?.summary).toBe("");
  });

  it("keeps organisation creators that only have a name", async () => {
    const record = {
      data: {
        attributes: {
          ...ARXIV_RECORD.data.attributes,
          creators: [{ name: "OpenAI", nameType: "Organizational" }],
        },
      },
    };
    expect((await fetchPaper(record))?.authors).toEqual(["OpenAI"]);
  });

  it("falls back to a DOI link when the record has no url", async () => {
    const { url: _dropped, ...withoutUrl } = ARXIV_RECORD.data.attributes;
    const paper = await fetchPaper({ data: { attributes: withoutUrl } });
    expect(paper?.link).toBe("https://doi.org/10.48550/arxiv.1706.03762");
  });

  it.each([
    ["an empty body", {}],
    ["no title", { data: { attributes: { doi: "10.48550/arxiv.1" } } }],
  ])("returns null for %s", async (_label, body) => {
    expect(await fetchPaper(body)).toBeNull();
  });
});
