import { OWNED_OUTPUT_ATTRIBUTE } from "./render-exact-time";

export interface AffectedMutationBatch {
  readonly addedRoots: readonly Element[];
  readonly datetimeTargets: readonly Element[];
  readonly removedRoots: readonly Element[];
  readonly displacedOutputSources: readonly Element[];
}

interface SchedulerInput {
  readonly document: Document;
  readonly onBatch: (batch: AffectedMutationBatch) => void;
  readonly getOwnedSourceForOutput: (node: Node) => Element | null;
}

function addUnique(items: Element[], value: Element): void {
  if (!items.includes(value)) items.push(value);
}

function collapseRoots(roots: readonly Element[]): Element[] {
  return roots.filter((root, index) =>
    !roots.some((other, otherIndex) => otherIndex !== index && other.contains(root))
  );
}

function coveredBy(roots: readonly Element[], element: Element): boolean {
  return roots.some((root) => root.contains(element));
}

export class DocumentMutationScheduler {
  private phase: "idle" | "observing" = "idle";
  private observer: MutationObserver | undefined;
  private generation = 0;
  private readonly suppressedRemovals = new Map<Node, number>();

  constructor(private readonly input: SchedulerInput) {}

  start(): void {
    if (this.phase === "observing") return;
    const generation = ++this.generation;
    const observer = new MutationObserver((records) => {
      if (
        this.phase !== "observing" ||
        this.observer !== observer ||
        this.generation !== generation
      ) return;
      this.handle(records);
    });
    try {
      observer.observe(this.input.document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["datetime"]
      });
    } catch (error) {
      observer.disconnect();
      throw error;
    }
    this.observer = observer;
    this.phase = "observing";
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.phase = "idle";
    this.generation += 1;
    this.suppressedRemovals.clear();
  }

  beforeOwnedOutputRemoval(output: HTMLTimeElement): void {
    if (
      this.phase === "observing" &&
      output.ownerDocument === this.input.document &&
      output.isConnected &&
      output.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)
    ) {
      this.suppressedRemovals.set(output, this.generation);
    }
  }

  private handle(records: readonly MutationRecord[]): void {
    const addedRoots: Element[] = [];
    const datetimeTargets: Element[] = [];
    const removedRoots: Element[] = [];
    const displacedOutputSources: Element[] = [];

    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target.nodeType === 1 && !this.input.getOwnedSourceForOutput(record.target)) {
          addUnique(datetimeTargets, record.target as Element);
        }
        continue;
      }

      if (this.input.getOwnedSourceForOutput(record.target)) continue;

      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        const source = this.input.getOwnedSourceForOutput(element);
        if (source) {
          if (source.parentNode !== element.parentNode || source.nextElementSibling !== element) {
            addUnique(displacedOutputSources, source);
          }
        } else {
          addUnique(addedRoots, element);
        }
      }

      for (const node of record.removedNodes) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        const suppressedGeneration = this.suppressedRemovals.get(element);
        if (suppressedGeneration === this.generation) {
          this.suppressedRemovals.delete(element);
          continue;
        }
        const source = this.input.getOwnedSourceForOutput(element);
        if (source) {
          if (source.parentNode !== element.parentNode || source.nextElementSibling !== element) {
            addUnique(displacedOutputSources, source);
          }
        } else {
          addUnique(removedRoots, element);
        }
      }
    }

    const normalizedAdded = collapseRoots(addedRoots);
    const normalizedRemoved = collapseRoots(removedRoots);
    const normalizedTargets = datetimeTargets.filter(
      (target, index) => !datetimeTargets.slice(0, index).includes(target) && !coveredBy(normalizedAdded, target)
    );
    const normalizedDisplaced = displacedOutputSources.filter(
      (source, index) =>
        !displacedOutputSources.slice(0, index).includes(source) &&
        !coveredBy(normalizedAdded, source) &&
        !normalizedTargets.includes(source)
    );

    this.suppressedRemovals.clear();
    if (
      normalizedAdded.length === 0 &&
      normalizedTargets.length === 0 &&
      normalizedRemoved.length === 0 &&
      normalizedDisplaced.length === 0
    ) return;
    this.input.onBatch({
      addedRoots: normalizedAdded,
      datetimeTargets: normalizedTargets,
      removedRoots: normalizedRemoved,
      displacedOutputSources: normalizedDisplaced
    });
  }
}
