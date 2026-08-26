import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  DiagnosticArchiveError,
  createDiagnosticsZip,
  downloadDiagnosticsZip,
  type DiagnosticArchiveSnapshot,
  type DownloadRuntime
} from "../../src/diagnostics/archive";

const snapshot: DiagnosticArchiveSnapshot = {
  entries: [{
    category: "lifecycle",
    timestamp: 1_700_000_000_000,
    hostname: "github.com",
    pageCategory: "repository",
    incognito: false,
    count: 2,
    reason: "adapter-matched",
    stack: ["frame:12:4"]
  }],
  environment: { browserFamily: "chromium", extensionVersion: "1.2.3" }
};

function expectArchiveError(action: () => unknown, code: DiagnosticArchiveError["code"]): void {
  try {
    action();
    throw new Error("expected archive error");
  } catch (error) {
    expect(error).toBeInstanceOf(DiagnosticArchiveError);
    expect((error as DiagnosticArchiveError).code).toBe(code);
  }
}

describe("diagnostic archive", () => {
  it("creates one JSON entry containing the complete safe snapshot", () => {
    const archive = createDiagnosticsZip(snapshot);
    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(["diagnostics.json"]);
    const json = files["diagnostics.json"];
    if (!json) throw new Error("diagnostics.json is missing");
    expect(JSON.parse(strFromU8(json))).toEqual(snapshot);
  });

  it("exports every retained entry when journal bytes fit but trusted metadata crosses the cap", () => {
    const entries = Array.from({ length: 44_345 }, (_, index) => ({
      category: "lifecycle" as const,
      timestamp: index,
      hostname: index < 20 ? "github.com." : "github.com",
      pageCategory: "repository" as const,
      incognito: false
    }));
    const environment = { browserFamily: "chromium" as const, extensionVersion: "12345678901234567890123456789012" };
    const journalBytes = new TextEncoder().encode(JSON.stringify({ entries })).byteLength;
    const archive = createDiagnosticsZip({ entries, environment });
    const files = unzipSync(archive);
    const json = files["diagnostics.json"];
    if (!json) throw new Error("diagnostics.json is missing");
    const exportedBytes = new TextEncoder().encode(strFromU8(json)).byteLength;
    const exported = JSON.parse(strFromU8(json)) as { entries: unknown[]; environment: unknown };
    expect(journalBytes).toBeLessThanOrEqual(5_000_000);
    expect(exportedBytes).toBeGreaterThan(5_000_000);
    expect(exported.entries).toHaveLength(entries.length);
    expect(exported.environment).toEqual(environment);
  });

  it("rejects empty, malformed, and unsafe snapshots before compression", () => {
    expectArchiveError(() => createDiagnosticsZip({ ...snapshot, entries: [] }), "empty");
    expectArchiveError(() => createDiagnosticsZip({ entries: snapshot.entries, environment: { browserFamily: "chromium" }, extra: true }), "invalid-snapshot");
    expectArchiveError(() => createDiagnosticsZip({
      ...snapshot,
      entries: [{ ...snapshot.entries[0], url: "https://private.invalid/path" }]
    }), "invalid-snapshot");
    const inheritedEnvironment = Object.create({ extensionVersion: "spoofed" }) as Record<string, unknown>;
    inheritedEnvironment.browserFamily = "chromium";
    expectArchiveError(() => createDiagnosticsZip({ entries: snapshot.entries, environment: inheritedEnvironment }), "invalid-snapshot");

    const inheritedRoot = Object.create({ secret: "private" }) as Record<string, unknown>;
    inheritedRoot.entries = snapshot.entries;
    inheritedRoot.environment = snapshot.environment;
    expectArchiveError(() => createDiagnosticsZip(inheritedRoot), "invalid-snapshot");

    const toJSONPrototype = {};
    Object.defineProperty(toJSONPrototype, "toJSON", { enumerable: false, value: () => ({ url: "https://private.invalid/token" }) });
    const rootWithToJSON = Object.create(toJSONPrototype) as Record<string, unknown>;
    rootWithToJSON.entries = snapshot.entries;
    rootWithToJSON.environment = snapshot.environment;
    let encoderCalls = 0;
    expectArchiveError(() => createDiagnosticsZip(rootWithToJSON, () => { encoderCalls += 1; return new Uint8Array(); }), "invalid-snapshot");
    expect(encoderCalls).toBe(0);

    const environmentWithToJSON = Object.create(toJSONPrototype) as Record<string, unknown>;
    environmentWithToJSON.browserFamily = "chromium";
    expectArchiveError(() => createDiagnosticsZip({ entries: snapshot.entries, environment: environmentWithToJSON }), "invalid-snapshot");

    const entriesWithToJSON = [...snapshot.entries];
    Object.setPrototypeOf(entriesWithToJSON, toJSONPrototype);
    expectArchiveError(() => createDiagnosticsZip({ entries: entriesWithToJSON, environment: snapshot.environment }), "invalid-snapshot");

    const eventWithToJSON = Object.create(toJSONPrototype) as Record<string, unknown>;
    Object.assign(eventWithToJSON, snapshot.entries[0]);
    expectArchiveError(() => createDiagnosticsZip({ entries: [eventWithToJSON], environment: snapshot.environment }), "invalid-snapshot");

    const stackWithToJSON = ["frame:1"];
    Object.setPrototypeOf(stackWithToJSON, toJSONPrototype);
    const eventWithUnsafeStack = { ...snapshot.entries[0], stack: stackWithToJSON };
    expectArchiveError(() => createDiagnosticsZip({ entries: [eventWithUnsafeStack], environment: snapshot.environment }), "invalid-snapshot");

    const oversizedEntries = Array.from({ length: 44_346 }, (_, index) => ({
      category: "lifecycle" as const,
      timestamp: index,
      hostname: "github.com",
      pageCategory: "repository" as const,
      incognito: false,
      adapterVersion: "12345678901234567890123456789012"
    }));
    expectArchiveError(() => createDiagnosticsZip({ entries: oversizedEntries, environment: snapshot.environment }), "invalid-snapshot");
    expectArchiveError(() => createDiagnosticsZip(snapshot, () => { throw new Error("encoder failed"); }), "compression-failed");
  });

  it("keeps the object URL alive through the one click and revokes it once", () => {
    const scheduled: Array<() => void> = [];
    const revoked: string[] = [];
    let clicked = 0;
    let clickedUrl = "";
    const runtime: DownloadRuntime = {
      Blob,
      createObjectURL: () => "blob:diagnostics",
      revokeObjectURL: (url) => { revoked.push(url); },
      createAnchor: () => ({
        href: "",
        download: "",
        click() { clicked += 1; clickedUrl = this.href; expect(revoked).toEqual([]); expect(this.download).toBe("no-more-ago-diagnostics.zip"); },
        remove() { /* local anchor cleanup */ }
      }),
      scheduleRevoke: (callback) => { scheduled.push(callback); }
    };
    downloadDiagnosticsZip(new Uint8Array([1, 2, 3]), runtime);
    expect(clicked).toBe(1);
    expect(clickedUrl).toBe("blob:diagnostics");
    expect(revoked).toEqual([]);
    expect(scheduled).toHaveLength(1);
    const revoke = scheduled[0];
    if (!revoke) throw new Error("revoke callback is missing");
    revoke();
    revoke();
    expect(revoked).toEqual(["blob:diagnostics"]);
  });

  it("cleans up when clicking or scheduling the revoke fails", () => {
    const revoked: string[] = [];
    let removed = 0;
    const base: DownloadRuntime = {
      Blob,
      createObjectURL: () => "blob:failed",
      revokeObjectURL: (url) => { revoked.push(url); },
      createAnchor: () => ({ href: "", download: "", click: () => { throw new Error("blocked"); }, remove: () => { removed += 1; } }),
      scheduleRevoke: () => { /* no callback */ }
    };
    expectArchiveError(() => { downloadDiagnosticsZip(new Uint8Array([1]), base); }, "download-failed");
    expect(revoked).toEqual(["blob:failed"]);
    expect(removed).toBe(1);

    revoked.length = 0;
    const schedulingFailure: DownloadRuntime = {
      ...base,
      createAnchor: () => ({ href: "", download: "", click: () => { /* click succeeded */ }, remove: () => { removed += 1; } }),
      scheduleRevoke: () => { throw new Error("scheduler failed"); }
    };
    expectArchiveError(() => { downloadDiagnosticsZip(new Uint8Array([1]), schedulingFailure); }, "download-failed");
    expect(revoked).toEqual(["blob:failed"]);
    expect(removed).toBe(2);
  });
});
