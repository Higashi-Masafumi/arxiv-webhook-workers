import { describe, expect, it } from "vitest";
import { reconstructAbstract, toPaper } from "../src/libs/openAlexClient";

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
    expect(reconstructAbstract(invertedIndex)).toBe(
      "Despite the recent progress in the field"
    );
  });

  it("tolerates gaps in the position sequence", () => {
    expect(reconstructAbstract({ a: [0], c: [2] })).toBe("a c");
  });

  it.each([null, undefined, {}])("returns an empty string for %s", (input) => {
    expect(reconstructAbstract(input)).toBe("");
  });
});

describe("openalex toPaper", () => {
  it("maps a work including the reconstructed abstract", () => {
    const work = {
      doi: "https://doi.org/10.1109/CVPR42600.2020.00975",
      title: "Momentum Contrast for Unsupervised Visual Representation Learning",
      publication_year: 2020,
      abstract_inverted_index: { We: [0], present: [1], MoCo: [2] },
      authorships: [
        { author: { display_name: "Kaiming He" } },
        { raw_author_name: "Haoqi Fan" },
      ],
      primary_location: { landing_page_url: "https://ieeexplore.ieee.org/document/9156697" },
    };

    expect(toPaper(work, "10.1109/cvpr42600.2020.00975")).toEqual({
      title: "Momentum Contrast for Unsupervised Visual Representation Learning",
      authors: ["Kaiming He", "Haoqi Fan"],
      summary: "We present MoCo",
      link: "https://ieeexplore.ieee.org/document/9156697",
      publishedYear: 2020,
      doi: "10.1109/cvpr42600.2020.00975",
      provider: "openalex",
    });
  });

  it("falls back to display_name and a DOI link", () => {
    const paper = toPaper({ display_name: "A Paper" }, "10.1000/xyz");
    expect(paper?.title).toBe("A Paper");
    expect(paper?.link).toBe("https://doi.org/10.1000/xyz");
    expect(paper?.publishedYear).toBeNull();
  });

  it("returns null without a title", () => {
    expect(toPaper({ title: null, display_name: null }, "10.1000/xyz")).toBeNull();
  });
});
