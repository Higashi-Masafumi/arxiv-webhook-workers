import { afterEach, describe, expect, it, vi } from "vitest";
import { CrossrefClient } from "../src/libs/crossrefClient";

/** Crossref のレスポンスを 1 件返す fetch スタブ */
function stubCrossref(message: unknown): void {
  vi.stubGlobal("fetch", async () => Response.json({ message }));
}

const fetchPaper = (message: unknown) => {
  stubCrossref(message);
  return new CrossrefClient().fetchByDoi("10.1000/xyz");
};

describe("CrossrefClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a typical work", async () => {
    stubCrossref({
      DOI: "10.1109/CVPR42600.2020.00975",
      URL: "http://dx.doi.org/10.1109/cvpr42600.2020.00975",
      title: ["Momentum Contrast for Unsupervised Visual Representation Learning"],
      author: [
        { given: "Kaiming", family: "He" },
        { given: "Haoqi", family: "Fan" },
        { given: "Yuxin", family: "Wu" },
      ],
      published: { "date-parts": [[2020, 6]] },
    });

    expect(await new CrossrefClient().fetchByDoi("10.1109/cvpr42600.2020.00975")).toEqual({
      title: "Momentum Contrast for Unsupervised Visual Representation Learning",
      authors: ["Kaiming He", "Haoqi Fan", "Yuxin Wu"],
      // 出版社が abstract を登録していないことは珍しくない
      summary: "",
      link: "http://dx.doi.org/10.1109/cvpr42600.2020.00975",
      publishedYear: 2020,
      doi: "10.1109/cvpr42600.2020.00975",
      provider: "crossref",
    });
  });

  it("converts a JATS abstract to plain text and drops the Abstract label", async () => {
    const paper = await fetchPaper({
      title: ["A Paper"],
      abstract:
        "<jats:title>Abstract</jats:title><jats:p>We introduce a method that is 5&#x0025; better.</jats:p>",
    });

    expect(paper?.summary).toBe("We introduce a method that is 5% better.");
  });

  it("keeps organisation authors that only have a name field", async () => {
    const paper = await fetchPaper({
      title: ["A Paper"],
      author: [{ name: "The LHCb Collaboration" }, { family: "Doe" }],
    });

    expect(paper?.authors).toEqual(["The LHCb Collaboration", "Doe"]);
  });

  it("falls back through the date fields in order of confidence", async () => {
    const paper = await fetchPaper({
      title: ["A Paper"],
      "published-online": { "date-parts": [[2021, 3, 1]] },
      created: { "date-parts": [[2022, 1, 1]] },
    });

    expect(paper?.publishedYear).toBe(2021);
  });

  it("synthesises a link when the record has no URL", async () => {
    expect((await fetchPaper({ title: ["A Paper"] }))?.link).toBe("https://doi.org/10.1000/xyz");
  });

  it("returns null year when no date field is present", async () => {
    expect((await fetchPaper({ title: ["A Paper"] }))?.publishedYear).toBeNull();
  });

  it.each([
    ["no title", { DOI: "10.1000/xyz" }],
    ["an empty title array", { title: [] }],
    ["no message at all", undefined],
  ])("returns null for a record with %s", async (_label, message) => {
    expect(await fetchPaper(message)).toBeNull();
  });
});
