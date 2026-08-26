/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-floating-promises, @typescript-eslint/no-unused-vars */
import { describe, expect, it, vi } from "vitest";
import { AdapterActivationCoordinator, type RuntimeAdapterDefinition } from "../../src/runtime/adapter-activation";
import { DOCUMENT_STATUS_MESSAGE } from "../../src/runtime/messages";

const github: RuntimeAdapterDefinition = {
  id: "synthetic",
  hostname: "synthetic.test",
  registration: { id: "synthetic-script", matches: ["https://synthetic.test/*"], js: ["content.js"], runAt: "document_start", allFrames: false, persistAcrossSessions: true },
  matches: (url) => url.hostname === "synthetic.test"
};

const sibling: RuntimeAdapterDefinition = {
  id: "sibling",
  hostname: "sibling.test",
  registration: { id: "sibling-script", matches: ["https://sibling.test/*"], js: ["content.js"], runAt: "document_start", allFrames: false, persistAcrossSessions: true },
  matches: (url) => url.hostname === "sibling.test"
};

function fakes() {
  const registered = new Map<string, typeof github.registration>();
  const phases = new Map<number, "waiting" | "active" | "stopped" | "failed">();
  const scripting = {
    getRegisteredContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => ids.flatMap((id) => registered.has(id) ? [{ ...registered.get(id)! }] : [])),
    registerContentScripts: vi.fn(async (scripts: typeof github.registration[]) => { for (const script of scripts) registered.set(script.id, script); }),
    updateContentScripts: vi.fn(async (scripts: typeof github.registration[]) => { for (const script of scripts) registered.set(script.id, script); }),
    unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => { for (const id of ids) registered.delete(id); }),
    executeScript: vi.fn(async (_input: { target: { tabId: number; allFrames: false }; files: string[] }) => undefined)
  };
  const tabs = {
    query: vi.fn(async () => [{ id: 3, url: "https://synthetic.test/document" }]),
    sendMessage: vi.fn(async (tabId: number, message: unknown) => message && typeof message === "object" && "type" in message && message.type === DOCUMENT_STATUS_MESSAGE ? { type: DOCUMENT_STATUS_MESSAGE, phase: phases.get(tabId) ?? "active" } : undefined)
  };
  return { scripting, tabs, registered, phases };
}

function multiFakes() {
  const registered = new Map<string, typeof github.registration>();
  const phases = new Map<number, "waiting" | "active" | "stopped" | "failed">();
  const scripting = {
    getRegisteredContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => ids.flatMap((id) => registered.has(id) ? [{ ...registered.get(id)! }] : [])),
    registerContentScripts: vi.fn(async (scripts: typeof github.registration[]) => { for (const script of scripts) registered.set(script.id, script); }),
    updateContentScripts: vi.fn(async (scripts: typeof github.registration[]) => { for (const script of scripts) registered.set(script.id, script); }),
    unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => { for (const id of ids) registered.delete(id); }),
    executeScript: vi.fn(async (_input: { target: { tabId: number; allFrames: false }; files: string[] }) => undefined)
  };
  const tabs = {
    query: vi.fn(async (query: { url?: readonly string[] }) => {
      if (query.url?.some((pattern) => pattern.includes("sibling.test"))) return [{ id: 4, url: "https://sibling.test/document" }];
      return [{ id: 3, url: "https://synthetic.test/document" }];
    }),
    sendMessage: vi.fn(async (tabId: number, message: unknown) => message && typeof message === "object" && "type" in message && message.type === DOCUMENT_STATUS_MESSAGE ? { type: DOCUMENT_STATUS_MESSAGE, phase: phases.get(tabId) ?? "active" } : undefined)
  };
  return { scripting, tabs, registered, phases };
}

describe("AdapterActivationCoordinator", () => {
  it("repairs a missing registration and injects exactly the top frame", async () => {
    const fake = fakes();
    const coordinator = new AdapterActivationCoordinator({ adapters: [github], ...fake });
    const result = await coordinator.reconcile({ revision: 1, mode: "cold-worker", policy: "enabled" });
    expect(result.failures).toEqual([]);
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledWith([github.registration]);
    expect(fake.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 3, allFrames: false }, files: ["content.js"] });
  });

  it("does not reinject a cold worker when the exact registration is already present", async () => {
    const fake = fakes();
    fake.scripting.registerContentScripts([{ ...github.registration }]);
    const coordinator = new AdapterActivationCoordinator({ adapters: [github], ...fake });
    await coordinator.reconcile({ revision: 2, mode: "cold-worker", policy: "enabled" });
    expect(fake.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("unregisters and tears down disabled tabs while preserving frame zero", async () => {
    const fake = fakes();
    fake.scripting.registerContentScripts([{ ...github.registration }]);
    const coordinator = new AdapterActivationCoordinator({ adapters: [github], ...fake });
    await coordinator.reconcile({ revision: 3, mode: "settings-change", policy: "disabled" });
    expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [github.registration.id] });
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(3, { type: "no-more-ago:teardown" }, { frameId: 0 });
  });

  it("updates a mismatched registration and sweeps an activation event even when already correct", async () => {
    const fake = fakes();
    fake.registered.set(github.registration.id, { ...github.registration, js: ["old-content.js"] });
    const coordinator = new AdapterActivationCoordinator({ adapters: [github], ...fake });
    const repaired = await coordinator.reconcile({ revision: 4, mode: "cold-worker", policy: "enabled" });
    expect(repaired.registration.synthetic).toBe("updated");
    expect(fake.scripting.updateContentScripts).toHaveBeenCalledWith([github.registration]);
    expect(fake.scripting.executeScript).toHaveBeenCalledTimes(1);
    fake.scripting.executeScript.mockClear();
    const sweep = await coordinator.reconcile({ revision: 4, mode: "activation-sweep", policy: "enabled" });
    expect(sweep.registration.synthetic).toBe("unchanged");
    expect(fake.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it("injects on an unchanged settings command and skips an already stopped disabled runtime", async () => {
    const fake = fakes();
    fake.registered.set(github.registration.id, { ...github.registration });
    fake.phases.set(3, "stopped");
    const coordinator = new AdapterActivationCoordinator({ adapters: [github], ...fake });
    await coordinator.reconcile({ revision: 5, mode: "settings-change", policy: "enabled" });
    expect(fake.scripting.executeScript).toHaveBeenCalledTimes(1);
    fake.scripting.executeScript.mockClear();
    await coordinator.reconcile({ revision: 6, mode: "settings-change", policy: "disabled" });
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(3, { type: DOCUMENT_STATUS_MESSAGE }, { frameId: 0 });
    expect(fake.tabs.sendMessage).not.toHaveBeenCalledWith(3, { type: "no-more-ago:teardown" }, { frameId: 0 });
  });

  it("failed-closed always unregisters and tears down without a status probe", async () => {
    const fake = fakes();
    fake.registered.set(github.registration.id, { ...github.registration });
    const coordinator = new AdapterActivationCoordinator({ adapters: [github], ...fake });
    const result = await coordinator.reconcile({ revision: null, mode: "failed-closed", policy: "unknown" });
    expect(result.failures).toEqual([]);
    expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [github.registration.id] });
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(3, { type: "no-more-ago:teardown" }, { frameId: 0 });
    expect(fake.tabs.sendMessage).not.toHaveBeenCalledWith(3, { type: DOCUMENT_STATUS_MESSAGE }, { frameId: 0 });
  });

  it("reselects adapters from returned URLs and keeps sibling tab failures isolated", async () => {
    const fake = fakes();
    fake.tabs.query.mockResolvedValue([
      { id: 3, url: "https://synthetic.test/document" },
      { id: 4, url: "https://synthetic.test/other-document" }
    ]);
    fake.tabs.query.mockResolvedValueOnce([
      { id: 3, url: "https://synthetic.test/document" },
      { id: 4, url: "https://synthetic.test/other-document" },
      { id: 5, url: "https://other.test/document" },
      { id: 6, url: "not-a-url" }
    ]);
    fake.scripting.executeScript.mockImplementationOnce(async (input: { target: { tabId: number; allFrames: false }; files: string[] }) => {
      if (input.target.tabId === 3) throw new Error("tab failed");
    });
    const coordinator = new AdapterActivationCoordinator({ adapters: [github], ...fake });
    const result = await coordinator.reconcile({ revision: 7, mode: "activation-sweep", policy: "enabled" });
    expect(fake.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(fake.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 3, allFrames: false }, files: ["content.js"] });
    expect(fake.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 4, allFrames: false }, files: ["content.js"] });
    expect(result.failures).toContainEqual({ scope: "tab", adapterId: "synthetic", tabId: 3, action: "inject" });
    expect(result.tabs).toContainEqual({ adapterId: "synthetic", tabId: 4, action: "inject", ok: true });
    const disabled = await coordinator.reconcile({ revision: 8, mode: "settings-change", policy: "disabled" });
    expect(disabled.failures).toEqual([]);
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(3, { type: "no-more-ago:teardown" }, { frameId: 0 });
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(4, { type: "no-more-ago:teardown" }, { frameId: 0 });
    const recovered = await coordinator.reconcile({ revision: 9, mode: "activation-sweep", policy: "enabled" });
    expect(recovered.failures).toEqual([]);
  });

  it.each(["get", "register", "update", "unregister"] as const)("attributes %s registration failure", async (operation) => {
    const fake = fakes();
    if (operation === "get") fake.scripting.getRegisteredContentScripts.mockRejectedValueOnce(new Error(operation));
    if (operation === "register") fake.scripting.registerContentScripts.mockRejectedValueOnce(new Error(operation));
    if (operation === "update") {
      fake.registered.set(github.registration.id, { ...github.registration, js: ["old.js"] });
      fake.scripting.updateContentScripts.mockRejectedValueOnce(new Error(operation));
    }
    if (operation === "unregister") {
      fake.registered.set(github.registration.id, { ...github.registration });
      fake.scripting.unregisterContentScripts.mockRejectedValueOnce(new Error(operation));
    }
    const coordinator = new AdapterActivationCoordinator({ adapters: [github], ...fake });
    const result = await coordinator.reconcile({ revision: 9, mode: operation === "unregister" ? "settings-change" : "cold-worker", policy: operation === "unregister" ? "disabled" : "enabled" });
    expect(result.failures).toContainEqual({ scope: "registration", adapterId: "synthetic", operation });
  });

  it("attributes query, status, teardown, and sibling continuation failures", async () => {
    const fake = fakes();
    fake.tabs.query.mockRejectedValueOnce(new Error("query"));
    const coordinator = new AdapterActivationCoordinator({ adapters: [github], ...fake });
    const queryFailure = await coordinator.reconcile({ revision: 10, mode: "activation-sweep", policy: "enabled" });
    expect(queryFailure.failures).toContainEqual({ scope: "matching-tabs-query", adapterId: "synthetic" });

    const statusFake = fakes();
    statusFake.registered.set(github.registration.id, { ...github.registration });
    statusFake.tabs.sendMessage.mockRejectedValueOnce(new Error("status"));
    const statusCoordinator = new AdapterActivationCoordinator({ adapters: [github], ...statusFake });
    const statusFailure = await statusCoordinator.reconcile({ revision: 11, mode: "cold-worker", policy: "disabled" });
    expect(statusFailure.failures).toContainEqual({ scope: "tab", adapterId: "synthetic", tabId: 3, action: "status" });
    expect(statusFake.tabs.sendMessage).toHaveBeenCalledWith(3, { type: "no-more-ago:teardown" }, { frameId: 0 });

    const teardownFake = fakes();
    teardownFake.registered.set(github.registration.id, { ...github.registration });
    teardownFake.tabs.sendMessage.mockImplementation(async (_tabId, message) => {
      if (message && typeof message === "object" && "type" in message && message.type === DOCUMENT_STATUS_MESSAGE) return { type: DOCUMENT_STATUS_MESSAGE, phase: "active" };
      throw new Error("teardown");
    });
    const teardownCoordinator = new AdapterActivationCoordinator({ adapters: [github], ...teardownFake });
    const teardownFailure = await teardownCoordinator.reconcile({ revision: 12, mode: "settings-change", policy: "disabled" });
    expect(teardownFailure.failures).toContainEqual({ scope: "tab", adapterId: "synthetic", tabId: 3, action: "teardown" });
  });

  it("reconciles affected adapters independently across disable and reenable transitions", async () => {
    const fake = multiFakes();
    const coordinator = new AdapterActivationCoordinator({ adapters: [github, sibling], ...fake });
    const initial = await coordinator.reconcile({ revision: 1, mode: "cold-worker", policy: "enabled", sitePreferences: {} });
    expect(initial.failures).toEqual([]);
    expect(fake.registered.has(github.registration.id)).toBe(true);
    expect(fake.registered.has(sibling.registration.id)).toBe(true);
    expect(fake.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 3, allFrames: false }, files: ["content.js"] });
    expect(fake.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 4, allFrames: false }, files: ["content.js"] });

    fake.scripting.getRegisteredContentScripts.mockClear();
    fake.scripting.registerContentScripts.mockClear();
    fake.scripting.unregisterContentScripts.mockClear();
    fake.scripting.executeScript.mockClear();
    fake.tabs.query.mockClear();
    fake.tabs.sendMessage.mockClear();
    const disabled = await coordinator.reconcile({ revision: 2, mode: "settings-change", policy: "enabled", sitePreferences: { "synthetic.test": false }, affectedHostnames: ["synthetic.test"] });
    expect(disabled.failures).toEqual([]);
    expect(fake.registered.has(github.registration.id)).toBe(false);
    expect(fake.registered.has(sibling.registration.id)).toBe(true);
    expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: [github.registration.id] });
    expect(fake.tabs.query).toHaveBeenCalledWith({ url: github.registration.matches });
    expect(fake.tabs.query).not.toHaveBeenCalledWith({ url: sibling.registration.matches });
    expect(fake.tabs.sendMessage).toHaveBeenCalledWith(3, { type: "no-more-ago:teardown" }, { frameId: 0 });
    expect(fake.tabs.sendMessage).not.toHaveBeenCalledWith(4, { type: "no-more-ago:teardown" }, { frameId: 0 });
    expect(fake.scripting.executeScript).not.toHaveBeenCalled();

    fake.scripting.getRegisteredContentScripts.mockClear();
    fake.scripting.registerContentScripts.mockClear();
    fake.scripting.unregisterContentScripts.mockClear();
    fake.scripting.executeScript.mockClear();
    fake.tabs.query.mockClear();
    fake.tabs.sendMessage.mockClear();
    const reenabled = await coordinator.reconcile({ revision: 3, mode: "settings-change", policy: "enabled", sitePreferences: { "synthetic.test": true }, affectedHostnames: ["synthetic.test"] });
    expect(reenabled.failures).toEqual([]);
    expect(fake.registered.has(github.registration.id)).toBe(true);
    expect(fake.registered.has(sibling.registration.id)).toBe(true);
    expect(fake.scripting.registerContentScripts).toHaveBeenCalledWith([github.registration]);
    expect(fake.tabs.query).toHaveBeenCalledWith({ url: github.registration.matches });
    expect(fake.tabs.query).not.toHaveBeenCalledWith({ url: sibling.registration.matches });
    expect(fake.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 3, allFrames: false }, files: ["content.js"] });
  });
});
