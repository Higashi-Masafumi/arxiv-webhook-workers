import { describe, expect, it } from "vitest";
import { parseXploreDocumentHtml, toPaperFromApi } from "../src/services/ieeeService";

/**
 * IEEE Xplore の論文ページは SPA なので、本文 DOM ではなく
 * サーバーが埋め込む xplGlobal.document.metadata を読む
 */
const XPLORE_HTML = `<!DOCTYPE html><html><head>
<meta name="citation_title" content="Stale meta title">
</head><body>
<script type="text/javascript">
  xplGlobal.document.metadata={"isEarlyAccess":false,"title":"Momentum Contrast for Unsupervised Visual Representation Learning","authors":[{"name":"Kaiming He","affiliation":["Facebook AI Research"],"id":"37085376299"},{"name":"Haoqi Fan","affiliation":["Facebook AI Research"]}],"abstract":"We present Momentum Contrast (MoCo) for unsupervised visual representation learning. The dictionary is a queue { of samples }.","doi":"10.1109/CVPR42600.2020.00975","publicationYear":"2020","articleNumber":"9156697","htmlLink":"/document/9156697/"};
</script>
</body></html>`;

describe("parseXploreDocumentHtml", () => {
  it("reads the embedded metadata object in preference to meta tags", () => {
    expect(parseXploreDocumentHtml(XPLORE_HTML, "9156697")).toEqual({
      title: "Momentum Contrast for Unsupervised Visual Representation Learning",
      authors: ["Kaiming He", "Haoqi Fan"],
      summary:
        "We present Momentum Contrast (MoCo) for unsupervised visual representation learning. The dictionary is a queue { of samples }.",
      link: "https://doi.org/10.1109/cvpr42600.2020.00975",
      publishedYear: 2020,
      doi: "10.1109/cvpr42600.2020.00975",
      provider: "ieee-html",
    });
  });

  it("falls back to citation_* meta tags when the embedded object is absent", () => {
    const html = `<head>
      <meta name="citation_title" content="A Fallback Paper">
      <meta name="citation_author" content="Doe, John">
      <meta name="citation_doi" content="10.1109/ABC.2021.12345">
      <meta name="citation_publication_date" content="2021">
    </head>`;

    expect(parseXploreDocumentHtml(html, "9156697")).toEqual({
      title: "A Fallback Paper",
      authors: ["John Doe"],
      summary: "",
      link: "https://doi.org/10.1109/abc.2021.12345",
      publishedYear: 2021,
      doi: "10.1109/abc.2021.12345",
      provider: "ieee-html",
    });
  });

  it("links to the Xplore page when no DOI is available", () => {
    const html = `<head><meta name="citation_title" content="No DOI Paper"></head>`;
    const paper = parseXploreDocumentHtml(html, "9156697");
    expect(paper?.link).toBe("https://ieeexplore.ieee.org/document/9156697");
    expect(paper?.doi).toBeUndefined();
  });

  it("returns null when the page has no title at all (e.g. a bot-block page)", () => {
    expect(parseXploreDocumentHtml("<html><body>Access Denied</body></html>", "9156697")).toBeNull();
  });
});

describe("toPaperFromApi", () => {
  it("maps a Metadata API article", () => {
    const article = {
      title: "Deep Residual Learning for Image Recognition",
      abstract: "Deeper neural networks are more difficult to train.",
      doi: "10.1109/CVPR.2016.90",
      publication_year: "2016",
      html_url: "https://ieeexplore.ieee.org/document/7780459/",
      authors: {
        authors: [{ full_name: "Kaiming He" }, { full_name: "Xiangyu Zhang" }],
      },
    };

    expect(toPaperFromApi(article, "7780459")).toEqual({
      title: "Deep Residual Learning for Image Recognition",
      authors: ["Kaiming He", "Xiangyu Zhang"],
      summary: "Deeper neural networks are more difficult to train.",
      link: "https://ieeexplore.ieee.org/document/7780459/",
      publishedYear: 2016,
      doi: "10.1109/cvpr.2016.90",
      provider: "ieee-api",
    });
  });

  it("returns null without a title", () => {
    expect(toPaperFromApi({ doi: "10.1109/x" }, "1")).toBeNull();
  });

  it("rejects an out-of-range publication year", () => {
    const paper = toPaperFromApi({ title: "T", publication_year: "0" }, "1");
    expect(paper?.publishedYear).toBeNull();
  });
});
