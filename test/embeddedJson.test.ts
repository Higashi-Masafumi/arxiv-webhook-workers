import { describe, expect, it } from "vitest";
import {
  extractJsonObjectAfter,
  parseEmbeddedJsonObject,
} from "../src/utils/embeddedJson";

describe("extractJsonObjectAfter", () => {
  it("extracts a flat object", () => {
    const html = `<script>window.data = {"a":1,"b":"two"};</script>`;
    expect(extractJsonObjectAfter(html, "window.data")).toBe('{"a":1,"b":"two"}');
  });

  it("balances nested objects", () => {
    const html = `<script>x.y = {"a":{"b":{"c":[1,2,{"d":3}]}},"e":4}; more();</script>`;
    expect(extractJsonObjectAfter(html, "x.y")).toBe(
      '{"a":{"b":{"c":[1,2,{"d":3}]}},"e":4}'
    );
  });

  it("ignores braces inside string literals", () => {
    const html = `<script>x = {"note":"a } b { c","ok":true};</script>`;
    expect(extractJsonObjectAfter(html, "x =")).toBe(
      '{"note":"a } b { c","ok":true}'
    );
  });

  it("ignores escaped quotes inside string literals", () => {
    const html = String.raw`<script>x = {"note":"he said \"}\" loudly","ok":true};</script>`;
    expect(extractJsonObjectAfter(html, "x =")).toBe(
      String.raw`{"note":"he said \"}\" loudly","ok":true}`
    );
  });

  it("returns null when the marker is absent", () => {
    expect(extractJsonObjectAfter("<html></html>", "window.data")).toBeNull();
  });

  it("returns null when the object is truncated", () => {
    expect(extractJsonObjectAfter(`x = {"a":{"b":1}`, "x =")).toBeNull();
  });
});

describe("parseEmbeddedJsonObject", () => {
  it("parses the extracted object", () => {
    const html = `<script>window.data = {"a":1};</script>`;
    expect(parseEmbeddedJsonObject(html, "window.data")).toEqual({ a: 1 });
  });

  it("returns null on invalid JSON", () => {
    const html = `<script>window.data = {a: 1, };</script>`;
    expect(parseEmbeddedJsonObject(html, "window.data")).toBeNull();
  });
});
