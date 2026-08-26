import { AdapterRegistry, defaultRegistry } from "../adapters/registry";
import { formatDateWithPresentation } from "./format-default-date";
import { renderExactTime, restoreExactTime, type OwnedOutputMutationSink } from "./render-exact-time";
import { resolveTrustedTimestamp } from "./resolve-trusted-timestamp";
import type { DisplaySettings } from "../settings/snapshot";
import type { DiagnosticEventInput } from "../diagnostics/events";

export type DocumentDiagnosticSink = (event: DiagnosticEventInput) => void;

export interface ProcessInput {
  readonly url: URL;
  readonly root: Document;
  /** A snapshot of locales for legacy callers. Prefer localesProvider. */
  readonly locales?: readonly string[];
  readonly localesProvider?: () => readonly string[];
  readonly display?: DisplaySettings;
  readonly displayProvider?: () => DisplaySettings;
  readonly registry?: AdapterRegistry;
  readonly diagnosticSink?: DocumentDiagnosticSink;
}

export interface ReconcileInput {
  readonly url: URL;
  readonly root: ParentNode;
  readonly locales?: readonly string[];
  readonly localesProvider?: () => readonly string[];
  readonly display?: DisplaySettings;
  readonly displayProvider?: () => DisplaySettings;
  readonly registry?: AdapterRegistry;
  readonly ownedOutputMutations?: OwnedOutputMutationSink;
  readonly diagnosticSink?: DocumentDiagnosticSink;
}

function processRegion(input: ProcessInput | ReconcileInput): readonly HTMLTimeElement[] {
  const { url, root, registry = defaultRegistry } = input;
  const locales = input.localesProvider?.() ?? input.locales ?? [];
  const display = input.displayProvider?.() ?? input.display;
  const ownedOutputMutations = "ownedOutputMutations" in input
    ? input.ownedOutputMutations
    : undefined;
  const diagnosticSink = input.diagnosticSink;
  const adapter = registry.select(url);
  if (!adapter) {
    if (diagnosticSink) diagnosticSink({ category: "skip", reason: "adapter-missing", count: 1 });
    return [];
  }
  const started = diagnosticSink ? performance.now() : undefined;
  if (diagnosticSink) diagnosticSink({ category: "adapter", reason: "adapter-matched", count: 1 });

  const outputs: HTMLTimeElement[] = [];
  for (const element of adapter.discover(root)) {
    const candidate = adapter.extract(element);
    const resolved = candidate ? resolveTrustedTimestamp(candidate) : null;
    if (!resolved) {
      restoreExactTime(element, ownedOutputMutations);
      if (diagnosticSink) diagnosticSink({ category: "skip", reason: "invalid-timestamp", count: 1 });
      continue;
    }
    const presentation = formatDateWithPresentation(
      resolved.instant,
      locales,
      display
    );
    if (presentation.text.length === 0) {
      restoreExactTime(element, ownedOutputMutations);
      if (diagnosticSink && presentation.error === "invalid-format") diagnosticSink({ category: "error", reason: "processing-failed", count: 1 });
      if (diagnosticSink) diagnosticSink({ category: "skip", reason: "candidate-skipped", count: 1 });
      continue;
    }
    if (presentation.error === "invalid-format") {
      restoreExactTime(element, ownedOutputMutations);
      if (diagnosticSink) diagnosticSink({ category: "skip", reason: "candidate-skipped", count: 1 });
      continue;
    }
    const output = renderExactTime(
      resolved.source,
      resolved.sourceDatetime,
      presentation.text
    );
    if (output) outputs.push(output);
  }
  if (diagnosticSink && started !== undefined) diagnosticSink({ category: "timing", count: outputs.length, durationMs: Math.max(0, performance.now() - started) });
  return outputs;
}

export function processDocument({
  url,
  root,
  locales,
  localesProvider,
  display,
  displayProvider,
  diagnosticSink,
  registry = defaultRegistry
}: ProcessInput): readonly HTMLTimeElement[] {
  return processRegion({
    url,
    root,
    registry,
    ...(locales === undefined ? {} : { locales }),
    ...(localesProvider === undefined ? {} : { localesProvider }),
    ...(display === undefined ? {} : { display }),
    ...(displayProvider === undefined ? {} : { displayProvider }),
    ...(diagnosticSink === undefined ? {} : { diagnosticSink })
  });
}

export function reconcileDocumentRegion(input: ReconcileInput): readonly HTMLTimeElement[] {
  return processRegion(input);
}
