import { describe, expect, it } from "vitest";
import { toPaper } from "../src/libs/crossrefClient";

describe("crossref toPaper", () => {
  it("maps a typical IEEE work", () => {
    const work = {
      DOI: "10.1109/CVPR42600.2020.00975",
      URL: "http://dx.doi.org/10.1109/cvpr42600.2020.00975",
      title: ["Momentum Contrast for Unsupervised Visual Representation Learning"],
      "container-title": ["2020 IEEE/CVF Conference on Computer Vision and Pattern Recognition"],
      author: [
        { given: "Kaiming", family: "He" },
        { given: "Haoqi", family: "Fan" },
        { given: "Yuxin", family: "Wu" },
      ],
      published: { "date-parts": [[2020, 6]] },
    };

    expect(toPaper(work, "10.1109/cvpr42600.2020.00975")).toEqual({
      title: "Momentum Contrast for Unsupervised Visual Representation Learning",
      authors: ["Kaiming He", "Haoqi Fan", "Yuxin Wu"],
      // IEEE は Crossref に abstract を登録しないことが多い
      summary: "",
      link: "http://dx.doi.org/10.1109/cvpr42600.2020.00975",
      publishedYear: 2020,
      doi: "10.1109/cvpr42600.2020.00975",
      provider: "crossref",
    });
  });

  it("converts a JATS abstract to plain text and drops the Abstract label", () => {
    const work = {
      DOI: "10.1000/xyz",
      title: ["A Paper"],
      abstract:
        "<jats:title>Abstract</jats:title><jats:p>We introduce a method that is 5&#x0025; better.</jats:p>",
    };

    expect(toPaper(work, "10.1000/xyz")?.summary).toBe(
      "We introduce a method that is 5% better."
    );
  });

  it("keeps organisation authors that only have a name field", () => {
    const work = {
      DOI: "10.1000/xyz",
      title: ["A Paper"],
      author: [{ name: "The LHCb Collaboration" }, { family: "Doe" }],
    };

    expect(toPaper(work, "10.1000/xyz")?.authors).toEqual([
      "The LHCb Collaboration",
      "Doe",
    ]);
  });

  it("falls back through the date fields in order of confidence", () => {
    const work = {
      DOI: "10.1000/xyz",
      title: ["A Paper"],
      "published-online": { "date-parts": [[2021, 3, 1]] },
      created: { "date-parts": [[2022, 1, 1]] },
    };

    expect(toPaper(work, "10.1000/xyz")?.publishedYear).toBe(2021);
  });

  it("synthesises a link when the record has no URL", () => {
    const work = { title: ["A Paper"] };
    expect(toPaper(work, "10.1000/xyz")?.link).toBe("https://doi.org/10.1000/xyz");
  });

  it("returns null when the record has no usable title", () => {
    expect(toPaper({ DOI: "10.1000/xyz" }, "10.1000/xyz")).toBeNull();
    expect(toPaper({ title: [] }, "10.1000/xyz")).toBeNull();
  });

  it("returns null year when no date field is present", () => {
    expect(toPaper({ title: ["A Paper"] }, "10.1000/xyz")?.publishedYear).toBeNull();
  });
});
