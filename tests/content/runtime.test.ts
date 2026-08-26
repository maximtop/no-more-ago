import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentTransformationController } from "../../src/core/document-transformation-controller";
import { installContentRuntime } from "../../src/content/runtime";
import { DEBUG_POLICY_UPDATED_MESSAGE, DOCUMENT_STATUS_MESSAGE, PRESENTATION_UPDATED_MESSAGE, TEARDOWN_DOCUMENT_MESSAGE, UPDATE_DEBUG_POLICY_MESSAGE, UPDATE_PRESENTATION_MESSAGE, isDocumentStatusResponse } from "../../src/runtime/messages";
import { createSyntheticRegistry } from "../fixtures/synthetic/adapter";

const SLOT = Symbol.for("no-more-ago.document-runtime");

function setReadyState(value: DocumentReadyState): void {
  Object.defineProperty(document, "readyState", { configurable: true, value });
}

function createMessages() {
  let listener: ((message: unknown, sender?: unknown, sendResponse?: (response: unknown) => void) => unknown) | undefined;
  return {
    onMessage: {
      addListener: vi.fn((next: (message: unknown, sender?: unknown, sendResponse?: (response: unknown) => void) => unknown) => { listener = next; })
    },
    dispatch(message: unknown) {
      let response: unknown;
      listener?.(message, undefined, (value) => { response = value; });
      return response;
    }
  };
}

function install(messages: ReturnType<typeof createMessages>) {
  return installContentRuntime({
    document,
    url: new URL("https://github.com/example/repo"),
    locales: ["en-US"],
    messages
  });
}

function state(revision: number, mode: "system" | "utc" | "iana", identifier = "America/New_York", debugEnabled = false) {
  return {
    availability: "ready" as const,
    revision,
    display: {
      formatMode: "system" as const,
      timeZone: mode === "iana" ? { mode, identifier } : { mode }
    },
    debugEnabled
  };
}

describe("installContentRuntime", () => {
  beforeEach(() => {
    const previous = (document as unknown as Record<symbol, { readonly handle?: { teardown(): void } } | undefined>)[SLOT];
    previous?.handle?.teardown();
    Reflect.deleteProperty(document, SLOT);
    document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
    setReadyState("loading");
  });

  it("installs one listener immediately and defers only processing", () => {
    const messages = createMessages();
    const firstHandle = install(messages);
    const secondHandle = install(messages);
    expect(firstHandle).toBe(secondHandle);
    expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(document.querySelector("time")).toBeNull();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(document.querySelectorAll("time")).toHaveLength(1);
    messages.dispatch({ type: "unrelated" });
    expect(document.querySelectorAll("time")).toHaveLength(1);
  });

  it("stays stopped when teardown arrives before readiness and reactivates explicitly", () => {
    const messages = createMessages();
    const handle = install(messages);
    messages.dispatch({ type: TEARDOWN_DOCUMENT_MESSAGE });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(document.querySelector("time")).toBeNull();
    expect(document.querySelector("relative-time")?.hasAttribute("hidden")).toBe(false);

    setReadyState("complete");
    expect(install(messages)).toBe(handle);
    expect(document.querySelectorAll("time")).toHaveLength(1);
    handle.teardown();
    expect(document.querySelector("time")).toBeNull();
    expect(document.querySelector("relative-time")?.hasAttribute("hidden")).toBe(false);
  });

  it("processes an interactive document synchronously and duplicate installation is idempotent", () => {
    setReadyState("interactive");
    const messages = createMessages();
    const handle = install(messages);
    expect(document.querySelectorAll("time")).toHaveLength(1);
    expect(install(messages)).toBe(handle);
    expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("time")).toHaveLength(1);
  });

  it("leaves a failed ready start stopped and retries the same runtime slot", () => {
    setReadyState("complete");
    const messages = createMessages();
    const error = new Error("observer setup failed");
    const observe = vi.spyOn(MutationObserver.prototype, "observe").mockImplementationOnce(() => {
      throw error;
    });

    expect(() => install(messages)).toThrow(error);
    expect(document.querySelector("time")).toBeNull();
    expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    observe.mockRestore();

    const handle = install(messages);
    expect(document.querySelectorAll("time")).toHaveLength(1);
    handle.teardown();
    expect(document.querySelector("time")).toBeNull();
  });

  it("rolls back a failed loading readiness callback and retries a fresh generation", () => {
    const messages = createMessages();
    const readiness = vi.spyOn(document, "addEventListener");
    const error = new Error("loading observer setup failed");
    const observe = vi.spyOn(MutationObserver.prototype, "observe").mockImplementationOnce(() => {
      throw error;
    });
    const handle = install(messages);
    const firstCallback = readiness.mock.calls
      .find(([type]) => type === "DOMContentLoaded")?.[1];
    if (typeof firstCallback !== "function") throw new Error("Expected readiness callback");

    expect(() => { firstCallback(new Event("DOMContentLoaded")); }).toThrow(error);
    expect(document.querySelector("time")).toBeNull();
    expect(() => { firstCallback(new Event("DOMContentLoaded")); }).not.toThrow();

    observe.mockRestore();
    const installsBeforeRetry = readiness.mock.calls.filter(([type]) => type === "DOMContentLoaded").length;
    expect(install(messages)).toBe(handle);
    const callbacks = readiness.mock.calls
      .filter(([type]) => type === "DOMContentLoaded")
      .map(([, callback]) => callback)
      .filter((callback): callback is EventListener => typeof callback === "function");
    expect(callbacks).toHaveLength(installsBeforeRetry + 1);
    callbacks.at(-1)?.(new Event("DOMContentLoaded"));
    expect(document.querySelectorAll("time")).toHaveLength(1);
    expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    readiness.mockRestore();
    handle.teardown();
  });

  it("reports waiting, active, and stopped phases through the singular listener", () => {
    const messages = createMessages();
    const handle = install(messages);
    expect(messages.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({ type: DOCUMENT_STATUS_MESSAGE, phase: "waiting" });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    const active = messages.dispatch({ type: DOCUMENT_STATUS_MESSAGE });
    expect(isDocumentStatusResponse(active)).toBe(true);
    expect(active).toMatchObject({ phase: "active" });
    messages.dispatch({ type: TEARDOWN_DOCUMENT_MESSAGE });
    expect(messages.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({ type: DOCUMENT_STATUS_MESSAGE, phase: "stopped" });
    expect(handle).toBeDefined();
  });

  it("marks a failed start and retries the same controller without adding a listener", () => {
    setReadyState("complete");
    const messages = createMessages();
    const observe = vi.spyOn(MutationObserver.prototype, "observe").mockImplementationOnce(() => { throw new Error("observer failed"); });
    expect(() => install(messages)).toThrow("observer failed");
    expect(messages.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({ type: DOCUMENT_STATUS_MESSAGE, phase: "failed" });
    observe.mockRestore();
    install(messages);
    expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(messages.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toEqual({ type: DOCUMENT_STATUS_MESSAGE, phase: "active" });
  });

  it("cleans up a ready partial pass before retrying and processing dynamic candidates", async () => {
    setReadyState("complete");
    const messages = createMessages();
    const start = vi.spyOn(DocumentTransformationController.prototype, "start");
    start.mockImplementationOnce(function(this: DocumentTransformationController) {
      start.mockRestore();
      const outputs = this.start();
      expect(outputs).toHaveLength(1);
      throw new Error("partial initial pass failed");
    });

    expect(() => install(messages)).toThrow("partial initial pass failed");
    expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
    expect(document.querySelector("relative-time")?.hasAttribute("hidden")).toBe(false);
    const handle = install(messages);
    expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
    const dynamic = document.createElement("relative-time");
    dynamic.setAttribute("datetime", "2026-08-24T10:15:00Z");
    dynamic.textContent = "dynamic";
    document.body.append(dynamic);
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
    handle.teardown();
    expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(0);
  });

  it("does not claim DOM ownership before authoritative hydration and uses UTC for first paint", async () => {
    setReadyState("complete");
    const messages = createMessages();
    let resolveLoad: ((value: unknown) => void) | undefined;
    const load = vi.fn(() => new Promise<unknown>((resolve) => { resolveLoad = resolve; }));
    installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: load, messages });
    expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
    expect(document.querySelector("relative-time")?.hasAttribute("hidden")).toBe(false);
    resolveLoad?.(state(4, "utc"));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("time[data-no-more-ago-output]")?.textContent).toBe(
      new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date("2026-08-23T10:15:00Z"))
    );
  });

  it("shares one hydration read across duplicate activations and waits for document readiness", async () => {
    const messages = createMessages();
    let resolveLoad: ((value: unknown) => void) | undefined;
    const load = vi.fn(() => new Promise<unknown>((resolve) => { resolveLoad = resolve; }));
    const handle = installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: load, messages });
    expect(installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: load, messages })).toBe(handle);
    expect(load).toHaveBeenCalledTimes(1);
    resolveLoad?.(state(1, "utc"));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(document.querySelector("time[data-no-more-ago-output]")).not.toBeNull();
    expect(installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: load, messages })).toBe(handle);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("accepts a newer update before hydration resolves and never regresses to an older read", async () => {
    setReadyState("complete");
    const messages = createMessages();
    let resolveLoad: ((value: unknown) => void) | undefined;
    const load = new Promise<unknown>((resolve) => { resolveLoad = resolve; });
    installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: () => load, messages });
    expect(messages.dispatch({ type: UPDATE_PRESENTATION_MESSAGE, revision: 8, display: state(8, "utc").display })).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 8 });
    resolveLoad?.(state(7, "iana"));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("time[data-no-more-ago-output]")?.textContent).toBe(
      new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date("2026-08-23T10:15:00Z"))
    );
  });

  it("reformats owned output once for a newer revision, is idempotent for duplicates, and rejects older/stopped updates", async () => {
    setReadyState("complete");
    const messages = createMessages();
    const reformat = vi.spyOn(DocumentTransformationController.prototype, "reformatOwned");
    installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: () => Promise.resolve(state(3, "utc")), messages });
    await Promise.resolve();
    await Promise.resolve();
    expect(messages.dispatch({ type: UPDATE_PRESENTATION_MESSAGE, revision: 4, display: state(4, "iana").display })).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 4 });
    expect(reformat).toHaveBeenCalledTimes(1);
    expect(messages.dispatch({ type: UPDATE_PRESENTATION_MESSAGE, revision: 4, display: state(4, "utc").display })).toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 4 });
    expect(reformat).toHaveBeenCalledTimes(1);
    expect(messages.dispatch({ type: UPDATE_PRESENTATION_MESSAGE, revision: 3, display: state(3, "utc").display })).toBeUndefined();
    messages.dispatch({ type: TEARDOWN_DOCUMENT_MESSAGE });
    expect(messages.dispatch({ type: UPDATE_PRESENTATION_MESSAGE, revision: 5, display: state(5, "utc").display })).toBeUndefined();
    reformat.mockRestore();
  });

  it("invalidates an unresolved old generation before reactivation and hydrates only the new generation", async () => {
    setReadyState("complete");
    const messages = createMessages();
    let resolveOld: ((value: unknown) => void) | undefined;
    let resolveNew: ((value: unknown) => void) | undefined;
    const oldLoad = vi.fn(() => new Promise<unknown>((resolve) => { resolveOld = resolve; }));
    const newLoad = vi.fn(() => new Promise<unknown>((resolve) => { resolveNew = resolve; }));
    const handle = installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: oldLoad, messages });
    messages.dispatch({ type: TEARDOWN_DOCUMENT_MESSAGE });
    expect(installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: newLoad, messages })).toBe(handle);
    expect(oldLoad).toHaveBeenCalledTimes(1);
    expect(newLoad).toHaveBeenCalledTimes(1);
    resolveOld?.(state(9, "iana"));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
    resolveNew?.(state(10, "utc"));
    await Promise.resolve();
    await Promise.resolve();
    expect(document.querySelector("time[data-no-more-ago-output]")?.textContent).toBe(
      new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date("2026-08-23T10:15:00Z"))
    );
  });

  it.each(["global", "site"] as const)("rehydrates the same retained document after %s disable and a saved zone change", async (policy) => {
    setReadyState("complete");
    const messages = createMessages();
    let saved = state(1, "iana", "America/New_York");
    const load = vi.fn(() => Promise.resolve(saved));
    const handle = installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: load, messages });
    await Promise.resolve();
    await Promise.resolve();
    const firstOutput = document.querySelector("time[data-no-more-ago-output]");
    expect(firstOutput?.textContent).toBe(new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date("2026-08-23T10:15:00Z")));
    expect(policy).toMatch(/global|site/);

    // The real policy change is represented by the existing document teardown
    // protocol. Saving while stopped does not deliver an update message.
    messages.dispatch({ type: TEARDOWN_DOCUMENT_MESSAGE });
    expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
    expect(document.querySelector("relative-time")?.hasAttribute("hidden")).toBe(false);
    saved = state(2, "utc");
    expect(messages.dispatch({ type: UPDATE_PRESENTATION_MESSAGE, revision: 2, display: saved.display })).toBeUndefined();

    const reactivated = installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: load, messages });
    expect(reactivated).toBe(handle);
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(document.querySelector("time[data-no-more-ago-output]")?.textContent).toBe(new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date("2026-08-23T10:15:00Z")));
  });

  it("resolves live locales for new candidates without changing already-owned output or polling", async () => {
    setReadyState("complete");
    const messages = createMessages();
    let locales: readonly string[] = ["en-US"];
    installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales, localesProvider: () => locales, messages });
    const first = document.querySelector("time[data-no-more-ago-output]")?.textContent;
    locales = ["en-GB"];
    const dynamic = document.createElement("relative-time");
    dynamic.setAttribute("datetime", "2026-08-23T10:15:00Z");
    dynamic.textContent = "dynamic";
    document.body.append(dynamic);
    await Promise.resolve();
    await Promise.resolve();
    const outputs = document.querySelectorAll("time[data-no-more-ago-output]");
    expect(outputs).toHaveLength(2);
    expect(outputs[0]?.textContent).toBe(first);
    expect(outputs[1]?.textContent).toBe(new Intl.DateTimeFormat(["en-GB"], { dateStyle: "medium", timeStyle: "short" }).format(new Date("2026-08-23T10:15:00Z")));
  });

  it("fails closed for unavailable or malformed hydration responses", async () => {
    setReadyState("complete");
    for (const response of [
      undefined,
      { availability: "unavailable", revision: null, display: null, failure: "settings-load" },
      { availability: "ready", revision: 1, display: { formatMode: "custom" } },
      { ...state(1, "utc"), extra: true },
      { ...state(1, "utc"), error: "arbitrary" },
      Object.assign(Object.create({ revision: 1 }), {
        availability: "ready",
        display: state(1, "utc").display,
        debugEnabled: false
      })
    ]) {
      Reflect.deleteProperty(document, SLOT);
      document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
      const messages = createMessages();
      installContentRuntime({ document, url: new URL("https://github.com/example/repo"), locales: ["en-US"], loadDisplayState: () => Promise.resolve(response), messages });
      await Promise.resolve();
      await Promise.resolve();
      expect(messages.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toMatchObject({ phase: "failed" });
      expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
      expect(document.querySelector("relative-time")?.hasAttribute("hidden")).toBe(false);
    }
  });

  it("enables and disables diagnostic processing on the single existing listener", async () => {
    setReadyState("complete");
    const messages = createMessages();
    const report = vi.fn<(event: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    installContentRuntime({
      document,
      url: new URL("https://github.com/example/repo"),
      locales: ["en-US"],
      loadDisplayState: () => Promise.resolve(state(3, "utc")),
      reportDiagnostic: report,
      messages
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
    expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);

    expect(messages.dispatch({ type: UPDATE_DEBUG_POLICY_MESSAGE, revision: 4, enabled: true }))
      .toEqual({ type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 4 });
    const dynamic = document.createElement("relative-time");
    dynamic.setAttribute("datetime", "2026-08-24T10:15:00Z");
    dynamic.textContent = "secret page text";
    document.body.append(dynamic);
    await Promise.resolve();
    await Promise.resolve();
    expect(report.mock.calls.some(([event]) => event.category === "mutation")).toBe(true);
    expect(report.mock.calls.some(([event]) => event.category === "timing")).toBe(true);
    expect(JSON.stringify(report.mock.calls)).not.toContain("secret page text");
    expect(JSON.stringify(report.mock.calls)).not.toContain("2026-08-24");
    expect(messages.dispatch({ type: UPDATE_DEBUG_POLICY_MESSAGE, revision: 3, enabled: false })).toBeUndefined();

    expect(messages.dispatch({ type: UPDATE_DEBUG_POLICY_MESSAGE, revision: 5, enabled: false }))
      .toEqual({ type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 5 });
    report.mockClear();
    const second = document.createElement("relative-time");
    second.setAttribute("datetime", "2026-08-25T10:15:00Z");
    document.body.append(second);
    await Promise.resolve();
    await Promise.resolve();
    expect(report).not.toHaveBeenCalled();
    expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(3);
    observe.mockRestore();
  });

  it("hydrates opted-in diagnostics and ignores rejected reporting without breaking dates", async () => {
    setReadyState("complete");
    const messages = createMessages();
    const report = vi.fn<(event: Record<string, unknown>) => Promise<void>>(() => Promise.reject(new Error("journal unavailable")));
    installContentRuntime({
      document,
      url: new URL("https://github.com/example/repo"),
      locales: ["en-US"],
      loadDisplayState: () => Promise.resolve(state(4, "utc", "America/New_York", true)),
      reportDiagnostic: report,
      messages
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalled();
    expect(document.querySelector("time[data-no-more-ago-output]")).not.toBeNull();
  });

  it("keeps a synthetic hostname unprocessed when the production registry is omitted", () => {
    setReadyState("complete");
    document.body.innerHTML = '<time-ago class="synthetic-event" datetime="2026-08-25T10:15:00Z">three hours ago</time-ago>';
    const messages = createMessages();
    const handle = installContentRuntime({ document, url: new URL("https://synthetic.test/example"), locales: ["en-US"], messages });
    expect(messages.dispatch({ type: DOCUMENT_STATUS_MESSAGE })).toMatchObject({ phase: "active" });
    expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
    expect(document.querySelector("time-ago")?.hasAttribute("hidden")).toBe(false);
    handle.teardown();
  });

  it("forwards an injected registry through the existing hydration, updates, diagnostics, and teardown", async () => {
    setReadyState("complete");
    document.body.innerHTML = '<time-ago class="synthetic-event" datetime="2026-08-25T10:15:00Z">private relative wording</time-ago>';
    const registry = createSyntheticRegistry();
    const messages = createMessages();
    const report = vi.fn<(event: Record<string, unknown>) => Promise<void>>(() => Promise.resolve());
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const input = {
      document,
      url: new URL("https://synthetic.test/example?private=secret"),
      locales: ["en-US"],
      registry,
      loadDisplayState: () => Promise.resolve(state(3, "utc")),
      reportDiagnostic: report,
      messages
    };
    try {
      const first = installContentRuntime(input);
      expect(installContentRuntime(input)).toBe(first);
      await Promise.resolve();
      await Promise.resolve();
      expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledTimes(1);
      const source = document.querySelector("time-ago");
      const output = document.querySelector<HTMLTimeElement>("time[data-no-more-ago-output]");
      expect(source?.hasAttribute("hidden")).toBe(true);
      expect(output?.dateTime).toBe("2026-08-25T10:15:00Z");
      expect(output?.textContent).toBe(new Intl.DateTimeFormat(["en-US"], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date("2026-08-25T10:15:00Z")));
      expect(report).not.toHaveBeenCalled();

      const custom = { formatMode: "custom" as const, pattern: "yyyy-MM-dd HH:mm 'UTC'", timeZone: { mode: "utc" as const } };
      expect(messages.dispatch({ type: UPDATE_PRESENTATION_MESSAGE, revision: 4, display: custom }))
        .toEqual({ type: PRESENTATION_UPDATED_MESSAGE, revision: 4 });
      expect(output?.textContent).toBe("2026-08-25 10:15 UTC");
      expect(messages.dispatch({ type: UPDATE_DEBUG_POLICY_MESSAGE, revision: 5, enabled: true }))
        .toEqual({ type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 5 });

      source?.setAttribute("datetime", "2026-08-26T11:16:00Z");
      await Promise.resolve();
      await Promise.resolve();
      expect(output?.textContent).toBe("2026-08-26 11:16 UTC");
      expect(report.mock.calls.some(([event]) => event.category === "mutation")).toBe(true);
      expect(JSON.stringify(report.mock.calls)).not.toMatch(/private relative wording|private=secret|2026-08-26/u);

      expect(messages.dispatch({ type: UPDATE_DEBUG_POLICY_MESSAGE, revision: 6, enabled: false }))
        .toEqual({ type: DEBUG_POLICY_UPDATED_MESSAGE, revision: 6 });
      report.mockClear();
      source?.setAttribute("datetime", "2026-08-27T12:17:00Z");
      await Promise.resolve();
      await Promise.resolve();
      expect(output?.textContent).toBe("2026-08-27 12:17 UTC");
      expect(report).not.toHaveBeenCalled();
      expect(messages.onMessage.addListener).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledTimes(1);
      first.teardown();
      expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
      expect(source?.hasAttribute("hidden")).toBe(false);
    } finally { observe.mockRestore(); }
  });
});
