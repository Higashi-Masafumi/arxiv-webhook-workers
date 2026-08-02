import { afterEach, describe, expect, it, vi } from "vitest";
import { DoiMetadataClient } from "../src/libs/doiMetadataClient";
import type { Paper } from "../src/types/paper";

/**
 * 基底クラスの共通処理だけを見るための最小の派生クラス
 */
class TestClient extends DoiMetadataClient<{ title?: string; abstract?: string }> {
  readonly name = "TestApi";

  protected endpoint(doi: string): string {
    return `https://example.test/works/${doi}`;
  }

  protected toPaper(response: { title?: string; abstract?: string }, doi: string): Paper | null {
    if (!response.title) return null;
    return {
      title: this.toPlainText(response.title),
      authors: [],
      summary: response.abstract
        ? this.stripAbstractLabel(this.toPlainText(response.abstract))
        : "",
      link: `https://doi.org/${doi}`,
      publishedYear: null,
      doi,
      provider: "crossref",
    };
  }
}

describe("DoiMetadataClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stub = (respond: () => Response) => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === "string" ? input : input.toString(),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return respond();
    });
    return calls;
  };

  it("returns null when the API does not have the DOI", async () => {
    stub(() => new Response("not found", { status: 404 }));

    expect(await new TestClient().fetchByDoi("10.1000/xyz")).toBeNull();
  });

  it("throws with the provider name on an API error", async () => {
    stub(() => new Response("boom", { status: 400 }));

    await expect(new TestClient().fetchByDoi("10.1000/xyz")).rejects.toThrow(
      "TestApi API returned 400"
    );
  });

  it("identifies itself and asks for JSON", async () => {
    const calls = stub(() => Response.json({ title: "A Paper" }));

    await new TestClient("dev@example.com").fetchByDoi("10.1000/xyz");

    expect(calls[0].url).toBe("https://example.test/works/10.1000/xyz");
    expect(calls[0].headers.Accept).toBe("application/json");
    expect(calls[0].headers["User-Agent"]).toContain("mailto:dev@example.com");
  });

  it("omits the mailto when no contact email is configured", async () => {
    const calls = stub(() => Response.json({ title: "A Paper" }));

    await new TestClient().fetchByDoi("10.1000/xyz");

    expect(calls[0].headers["User-Agent"]).not.toContain("mailto");
  });
});

/**
 * API レスポンスの整形（ページのスクレイピング用ではない）
 */
describe("DoiMetadataClient text handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const clean = async (field: "title" | "abstract", value: string) => {
    vi.stubGlobal("fetch", async () => Response.json({ title: "A Paper", [field]: value }));
    const paper = await new TestClient().fetchByDoi("10.1000/xyz");
    return field === "title" ? paper?.title : paper?.summary;
  };

  it.each([
    ["decodes XML entities", "a &amp; b &lt; c &gt; d &quot;e&quot;", 'a & b < c > d "e"'],
    ["decodes numeric references", "5&#x0025; and &#956;m", "5% and μm"],
    ["leaves unknown entities untouched", "&notarealentity;", "&notarealentity;"],
    ["strips tags", "<jats:p>Hello <b>world</b></jats:p>", "Hello world"],
    ["collapses whitespace", "line one\n\n  line two", "line one line two"],
  ])("%s", async (_label, input, expected) => {
    expect(await clean("title", input)).toBe(expected);
  });

  it("does not treat escaped angle brackets as tags", async () => {
    // タグ除去 -> 実体参照デコード の順でないと本文の &lt;p&gt; が消えてしまう
    expect(await clean("title", "<jats:p>use &lt;p&gt; tags</jats:p>")).toBe("use <p> tags");
  });

  it.each([
    ["Abstract We propose a method.", "We propose a method."],
    ["ABSTRACT: We propose a method.", "We propose a method."],
    ["Abstract - We propose a method.", "We propose a method."],
    ["We propose a method.", "We propose a method."],
  ])("drops the leading Abstract label in %s", async (input, expected) => {
    expect(await clean("abstract", input)).toBe(expected);
  });
});
