import { describe, expect, it } from "vitest";
import { mergePapers, needsEnrichment } from "../src/services/paperService";
import type { Paper } from "../src/types/paper";

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
