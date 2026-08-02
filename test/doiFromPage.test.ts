import { describe, expect, it } from "vitest";
import { findDoi } from "../src/libs/doiFromPage";

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
