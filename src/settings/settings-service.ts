import {
  DEFAULT_SETTINGS_SNAPSHOT,
  SETTINGS_PREVIOUS_STORAGE_KEY,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEY,
  createSettingsSnapshot,
  isCanonicalHostname,
  parseDisplaySettings,
  parseSettingsSnapshot,
  type DisplaySettings,
  type SettingsLoadResult,
  type SettingsSnapshotV5
} from "./snapshot";
import { validateCustomFormatPattern } from "./custom-format";

export interface SettingsStorage {
  get(keys?: string | readonly string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export type SettingsWriteResult =
  | { readonly ok: true; readonly changed: boolean; readonly snapshot: SettingsSnapshotV5 }
  | { readonly ok: false; readonly error: "persistence-failed" | "invalid-hostname" | "invalid-time-zone" | "invalid-format" | "invalid-display-settings" | "invalid-debug"; readonly snapshot: SettingsSnapshotV5 };

export type TimeZoneAvailability = (identifier: string) => boolean;

function defaultTimeZoneAvailability(identifier: string): boolean {
  try { new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions(); return true; } catch { return false; }
}

function sameDisplay(a: DisplaySettings, b: DisplaySettings): boolean {
  if (a.formatMode !== b.formatMode) return false;
  if (a.formatMode === "custom" && b.formatMode === "custom" && a.pattern !== b.pattern) return false;
  if (a.timeZone.mode !== b.timeZone.mode) return false;
  return a.timeZone.mode !== "iana" || b.timeZone.mode !== "iana" || a.timeZone.identifier === b.timeZone.identifier;
}

export class SettingsService {
  private current: SettingsSnapshotV5 | undefined;
  private loadError: "load-failed" | "invalid-settings" | undefined;
  private mutationTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly storage: SettingsStorage,
    private readonly key = SETTINGS_STORAGE_KEY,
    private readonly isTimeZoneAvailable: TimeZoneAvailability = defaultTimeZoneAvailability
  ) {}

  public async load(): Promise<SettingsLoadResult> {
    let values: Record<string, unknown>;
    try {
      values = await this.storage.get([this.key, SETTINGS_PREVIOUS_STORAGE_KEY]);
    } catch {
      this.loadError = "load-failed";
      return { ok: false, error: "load-failed" };
    }

    const hasCurrent = Object.hasOwn(values, this.key);
    const hasPrevious = Object.hasOwn(values, SETTINGS_PREVIOUS_STORAGE_KEY);
    if (!hasCurrent && !hasPrevious) {
      this.loadError = undefined;
      this.current = DEFAULT_SETTINGS_SNAPSHOT;
      return { ok: true, snapshot: this.current, source: "default" };
    }

    const snapshot = hasCurrent ? parseSettingsSnapshot(values[this.key]) : null;
    if (snapshot) {
      this.loadError = undefined;
      this.current = snapshot;
      return { ok: true, snapshot, source: "stored" };
    }

    // A newer schema must never be replaced by an older backup. It may contain
    // fields this unpublished build does not understand, so fail closed.
    const rawCurrent = hasCurrent ? values[this.key] : undefined;
    if (isUnknownFutureSnapshot(rawCurrent)) {
      this.loadError = "invalid-settings";
      return { ok: false, error: "invalid-settings" };
    }

    const previous = hasPrevious ? parseSettingsSnapshot(values[SETTINGS_PREVIOUS_STORAGE_KEY]) : null;
    if (!previous) {
      this.loadError = "invalid-settings";
      return { ok: false, error: "invalid-settings" };
    }

    try {
      await this.storage.set(this.pair(previous, previous));
    } catch {
      this.loadError = "invalid-settings";
      return { ok: false, error: "invalid-settings" };
    }
    this.loadError = undefined;
    this.current = previous;
    return { ok: true, snapshot: previous, source: "recovered" };
  }

  public get loadedSnapshot(): SettingsSnapshotV5 | undefined { return this.current; }
  public get lastLoadError(): "load-failed" | "invalid-settings" | undefined { return this.loadError; }
  private fallbackSnapshot(): SettingsSnapshotV5 { return this.current ?? DEFAULT_SETTINGS_SNAPSHOT; }
  private pair(current: SettingsSnapshotV5, previous: SettingsSnapshotV5): Record<string, unknown> {
    return { [this.key]: current, [SETTINGS_PREVIOUS_STORAGE_KEY]: previous };
  }

  private async mutate(mutator: (current: SettingsSnapshotV5) => SettingsSnapshotV5 | null): Promise<SettingsWriteResult> {
    let result: SettingsWriteResult | undefined;
    const run = this.mutationTail.then(async () => {
      const loaded = await this.load();
      if (!loaded.ok) { result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() }; return; }
      const candidate = mutator(loaded.snapshot);
      if (candidate === null) { result = { ok: true, changed: false, snapshot: loaded.snapshot }; return; }
      const parsedCandidate = parseSettingsSnapshot(candidate);
      if (parsedCandidate === null) {
        result = { ok: false, error: "invalid-display-settings", snapshot: loaded.snapshot };
        return;
      }
      try { await this.storage.set(this.pair(parsedCandidate, loaded.snapshot)); }
      catch { result = { ok: false, error: "persistence-failed", snapshot: loaded.snapshot }; return; }
      this.current = parsedCandidate; result = { ok: true, changed: true, snapshot: parsedCandidate };
    });
    this.mutationTail = run.then(() => undefined, () => undefined);
    try { await run; } catch { result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() }; }
    return result ?? { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
  }

  public async setGlobalEnabled(enabled: boolean): Promise<SettingsWriteResult> {
    if (typeof enabled !== "boolean") return { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
    return this.mutate((current) => current.globalEnabled === enabled ? null : createSettingsSnapshot(current.revision + 1, enabled, current.sitePreferences, current.display, current.debugEnabled));
  }

  public async setSiteEnabled(hostname: string, enabled: boolean): Promise<SettingsWriteResult> {
    if (!isCanonicalHostname(hostname) || typeof enabled !== "boolean") return { ok: false, error: "invalid-hostname", snapshot: this.fallbackSnapshot() };
    return this.mutate((current) => {
      if (Object.hasOwn(current.sitePreferences, hostname) && current.sitePreferences[hostname] === enabled) return null;
      const entries = Object.entries(current.sitePreferences);
      const index = entries.findIndex(([key]) => key === hostname);
      if (index >= 0) entries[index] = [hostname, enabled]; else entries.push([hostname, enabled]);
      return createSettingsSnapshot(current.revision + 1, current.globalEnabled, Object.fromEntries(entries), current.display, current.debugEnabled);
    });
  }

  public async setDisplaySettings(display: unknown): Promise<SettingsWriteResult> {
    if (typeof display === "object" && display !== null && Object.hasOwn(display, "formatMode") && (display as { formatMode?: unknown }).formatMode === "custom") {
      const pattern = (display as { pattern?: unknown }).pattern;
      if (!validateCustomFormatPattern(pattern).ok) return { ok: false, error: "invalid-format", snapshot: this.fallbackSnapshot() };
    }
    const parsed = parseDisplaySettings(display);
    if (parsed === null) return { ok: false, error: "invalid-display-settings", snapshot: this.fallbackSnapshot() };
    if (parsed.timeZone.mode === "iana" && !this.isTimeZoneAvailable(parsed.timeZone.identifier)) return { ok: false, error: "invalid-time-zone", snapshot: this.fallbackSnapshot() };
    return this.mutate((current) => sameDisplay(current.display, parsed) ? null : createSettingsSnapshot(current.revision + 1, current.globalEnabled, current.sitePreferences, parsed, current.debugEnabled));
  }

  public async setDebugEnabled(enabled: boolean): Promise<SettingsWriteResult> {
    if (typeof enabled !== "boolean") {
      return { ok: false, error: "invalid-debug", snapshot: this.fallbackSnapshot() };
    }
    return this.mutate((current) => current.debugEnabled === enabled
      ? null
      : createSettingsSnapshot(current.revision + 1, current.globalEnabled, current.sitePreferences, current.display, enabled));
  }

  /** Replace an unrecoverable pair with a known-good default pair. */
  public async resetAll(): Promise<SettingsWriteResult> {
    let result: SettingsWriteResult | undefined;
    const run = this.mutationTail.then(async () => {
      const defaults = DEFAULT_SETTINGS_SNAPSHOT;
      try {
        await this.storage.set(this.pair(defaults, defaults));
      } catch {
        result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
        return;
      }
      this.current = defaults;
      this.loadError = undefined;
      result = { ok: true, changed: true, snapshot: defaults };
    });
    this.mutationTail = run.then(() => undefined, () => undefined);
    try { await run; } catch { result = { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() }; }
    return result ?? { ok: false, error: "persistence-failed", snapshot: this.fallbackSnapshot() };
  }

  public async readLatest(): Promise<SettingsLoadResult> { return this.load(); }
}

function isUnknownFutureSnapshot(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.hasOwn(value, "schemaVersion")
    && typeof (value as { schemaVersion?: unknown }).schemaVersion === "number"
    && (value as { schemaVersion: number }).schemaVersion > SETTINGS_SCHEMA_VERSION;
}
