import { describe, expect, it } from "vitest";
import { parseArxivXml } from "../src/services/arxivService";
import { ArxivApiError } from "../src/utils/errors";

const ARXIV_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="html">ArXiv Query: search_query=&amp;id_list=1706.03762</title>
  <id>http://arxiv.org/api/feed-id</id>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You Need</title>
    <summary>  The dominant sequence transduction models are based on complex recurrent
or convolutional neural networks.
</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
  </entry>
</feed>`;

describe("parseArxivXml", () => {
  it("parses an entry, ignoring the feed-level title and id", () => {
    expect(parseArxivXml(ARXIV_FEED, "1706.03762")).toEqual({
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani", "Noam Shazeer"],
      summary:
        "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
      link: "http://arxiv.org/abs/1706.03762v7",
      publishedYear: 2017,
      doi: "10.48550/arxiv.1706.03762",
      provider: "arxiv",
    });
  });

  it("omits the DOI when no arXiv id was supplied", () => {
    expect(parseArxivXml(ARXIV_FEED).doi).toBeUndefined();
  });

  it("throws when the feed contains no entry", () => {
    const empty = `<feed xmlns="http://www.w3.org/2005/Atom"><title>none</title></feed>`;
    expect(() => parseArxivXml(empty)).toThrow(ArxivApiError);
  });
});
