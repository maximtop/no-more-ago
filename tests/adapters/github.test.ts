import { describe, expect, it } from "vitest";

import { defaultRegistry } from "../../src/adapters/registry";
import { EXPLICIT_ZONED_DATETIME_RULE } from "../../src/adapters/types";

describe("GitHub adapter registry", () => {
  it("selects only exact GitHub HTTP(S) URLs", () => {
    expect(defaultRegistry.select(new URL("https://github.com/org/repo"))?.id).toBe("github");
    expect(defaultRegistry.select(new URL("http://github.com/org/repo"))?.id).toBe("github");
    expect(defaultRegistry.select(new URL("https://gist.github.com/org/1"))).toBeNull();
    expect(defaultRegistry.select(new URL("https://github.example/org/repo"))).toBeNull();
  });

  it("discovers and extracts a trusted source description", () => {
    document.body.innerHTML =
      '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
    const adapter = defaultRegistry.select(new URL("https://github.com/org/repo"));
    expect(adapter).not.toBeNull();
    if (!adapter) throw new Error("Expected the GitHub adapter");

    const [element] = adapter.discover(document);
    expect(element).toBeDefined();
    if (!element) throw new Error("Expected one discovered relative-time element");

    expect(adapter.extract(element)).toMatchObject({
      adapterId: "github",
      rawDatetime: "2026-08-23T10:15:00Z",
      sourceKind: "relative-time",
      timestampRule: EXPLICIT_ZONED_DATETIME_RULE
    });
  });

  it("includes an eligible element root exactly once in bounded discovery", () => {
    document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z"><time-ago datetime="2026-08-24T10:15:00Z">nested</time-ago></relative-time>';
    const adapter = defaultRegistry.select(new URL("https://github.com/org/repo"));
    const root = document.body.firstElementChild;
    if (!adapter || !root) throw new Error("Expected adapter and root");
    expect(adapter.discover(root)).toEqual([root, root.firstElementChild]);
    expect(adapter.discover(document.createElement("aside"))).toEqual([]);
  });

  it.each([
    ["relative-time", "relative-time"],
    ["time-ago", "time-ago"],
    ["time-until", "time-until"]
  ] as const)("supports the approved %s source kind", (tagName, sourceKind) => {
    document.body.innerHTML = `<${tagName} datetime=" 2026-08-23T10:15Z ">visible</${tagName}>`;
    const adapter = defaultRegistry.select(new URL("https://github.com/any/path"));
    expect(adapter).not.toBeNull();
    const element = document.body.firstElementChild;
    expect(element).not.toBeNull();
    if (!element) throw new Error("Expected an approved source element");
    expect(adapter?.discover(document)).toEqual([element]);
    expect(adapter?.extract(element)).toEqual({
      adapterId: "github",
      source: element,
      sourceKind,
      rawDatetime: " 2026-08-23T10:15Z ",
      timestampRule: EXPLICIT_ZONED_DATETIME_RULE
    });
  });

  it.each([
    '<relative-time>no datetime</relative-time>',
    '<relative-time datetime=""></relative-time>',
    '<relative-time datetime="   ">visible</relative-time>',
    '<relative-time datetime="2026-08-23T10:15Z" format="datetime">absolute</relative-time>',
    '<relative-time datetime="2026-08-23T10:15Z" format=" DATETIME ">absolute</relative-time>',
    '<local-time datetime="2026-08-23T10:15Z">local</local-time>',
    '<time datetime="2026-08-23T10:15Z">generic</time>',
    '<relative-time title="2026-08-23T10:15Z" aria-label="2026-08-23T10:15Z" data-date="2026-08-23T10:15Z">prose</relative-time>'
  ])("does not extract unsafe or non-authoritative markup: %s", (markup) => {
    document.body.innerHTML = markup;
    const original = document.body.innerHTML;
    const adapter = defaultRegistry.select(new URL("https://github.com/any/path"));
    expect(adapter).not.toBeNull();
    for (const element of adapter?.discover(document) ?? []) {
      expect(adapter?.extract(element)).toBeNull();
    }
    expect(document.body.innerHTML).toBe(original);
  });

  it.each([
    "https://gist.github.com/org/1",
    "https://www.github.com/org/repo",
    "https://github.com.example/org/repo",
    "https://github.io/org/repo",
    "ftp://github.com/org/repo"
  ])("does not select %s", (url) => {
    expect(defaultRegistry.select(new URL(url))).toBeNull();
  });
});
