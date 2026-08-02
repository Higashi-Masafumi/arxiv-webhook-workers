import { afterEach, describe, expect, it, vi } from "vitest";
import { IeeeDoiResolver } from "../src/libs/ieeeDoiResolver";

describe("IeeeDoiResolver", () => {
  const ARTICLE = { articles: [{ doi: "10.1109/CVPR42600.2020.00975" }] };

  function stubFetch(respond: () => Response): string[] {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      calls.push(typeof input === "string" ? input : input.toString());
      return respond();
    });
    return calls;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the DOI from an IEEE document URL", async () => {
    const calls = stubFetch(() => Response.json(ARTICLE));

    const doi = await new IeeeDoiResolver("secret").resolveDoi(
      "https://ieeexplore.ieee.org/document/9156697"
    );

    expect(doi).toBe("10.1109/cvpr42600.2020.00975");
    expect(calls[0]).toContain("article_number=9156697");
    expect(calls[0]).toContain("ieeexploreapi.ieee.org");
  });

  it.each([
    ["abstract path", "https://ieeexplore.ieee.org/abstract/document/9156697/"],
    ["stamp.jsp", "https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=9156697"],
    ["articleDetails.jsp", "https://ieeexplore.ieee.org/xpl/articleDetails.jsp?arnumber=9156697"],
  ])("handles the %s form", async (_label, url) => {
    const calls = stubFetch(() => Response.json(ARTICLE));

    await new IeeeDoiResolver("secret").resolveDoi(url);

    expect(calls[0]).toContain("article_number=9156697");
  });

  it("does nothing without an API key", async () => {
    const calls = stubFetch(() => Response.json(ARTICLE));

    const doi = await new IeeeDoiResolver().resolveDoi(
      "https://ieeexplore.ieee.org/document/9156697"
    );

    expect(doi).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it.each([
    ["a non-IEEE URL", "https://dl.acm.org/doi/10.1145/3292500.3330701"],
    ["an IEEE URL without an article number", "https://ieeexplore.ieee.org/browse/periodicals"],
  ])("ignores %s", async (_label, url) => {
    const calls = stubFetch(() => Response.json(ARTICLE));

    expect(await new IeeeDoiResolver("secret").resolveDoi(url)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("returns undefined when the API has no article", async () => {
    stubFetch(() => Response.json({ articles: [] }));

    expect(
      await new IeeeDoiResolver("secret").resolveDoi("https://ieeexplore.ieee.org/document/1")
    ).toBeUndefined();
  });

  it("points at the API key when the request is rejected", async () => {
    stubFetch(() => new Response("Developer Inactive", { status: 403 }));

    await expect(
      new IeeeDoiResolver("bad-key").resolveDoi("https://ieeexplore.ieee.org/document/9156697")
    ).rejects.toThrow(/check IEEE_API_KEY/);
  });

  it("does not leak the API key when the request itself fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connect ECONNREFUSED apikey=secret");
    });

    // 通信エラーはリトライ対象なので、待ち時間を飛ばす
    vi.useFakeTimers();
    try {
      const assertion = expect(
        new IeeeDoiResolver("secret").resolveDoi("https://ieeexplore.ieee.org/document/9156697")
      ).rejects.toThrow(/^IEEE Xplore API request failed$/);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
