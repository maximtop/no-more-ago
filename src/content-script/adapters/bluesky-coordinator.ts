/**
 * @file Coordinates document-local Bluesky resolution, caching, and stale-result rejection.
 */

import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_MAX_COUNT,
    DIAGNOSTIC_REASON,
} from '../../shared/diagnostics/contracts';

import {
    BLUESKY_TARGET_ROLE,
    createBlueskyAdapter,
    describeBlueskySource,
    discoverBlueskyRelativeTargets,
    matchesBlueskyUrl,
    type BlueskyRelativeTarget,
    type ResolvedBlueskyTarget,
} from './bluesky';
import {
    BLUESKY_BATCH_LIMIT,
    BLUESKY_LOOKUP_STATUS,
    type BlueskyAppView,
    type BlueskyPostRecord,
} from './bluesky-appview';
import {
    createBlueskyPostUri,
    isValidBlueskyDid,
} from './bluesky-identity';

import type { TimestampSourceRule } from './types';
import type { DocumentDiagnosticSink } from '../diagnostics';

/**
 * Non-identifying diagnostic totals accumulated during one drain.
 */
interface DiagnosticCounts {
    /**
     * Number of requested identities affected by complete request failures.
     */
    failure: number;

    /**
     * Number of requested identities absent from successful partial responses.
     */
    partial: number;
}

/**
 * Dependencies owned by one document-local Bluesky coordinator.
 */
export interface BlueskyCoordinatorInput {
    /**
     * Document whose current source nodes may be resolved.
     */
    readonly document: Document;

    /**
     * Trusted document URL used to confirm exact Bluesky activation.
     */
    readonly url: URL;

    /**
     * Anonymous public AppView capability.
     */
    readonly appView: BlueskyAppView;

    /**
     * Dynamically supplies the current opt-in diagnostic sink.
     */
    readonly getDiagnosticSink: () => DocumentDiagnosticSink | undefined;

    /**
     * Requests exact-source reconciliation after cached presentation state changes.
     */
    readonly onSourcesChanged: (sources: readonly Element[]) => void;
}

/**
 * Public lifecycle consumed by the document transformation controller.
 */
export interface BlueskyCoordinator {
    /**
     * Synchronous timestamp rule backed by current document resolutions.
     */
    readonly rule: TimestampSourceRule;

    /**
     * Begins a fresh document-local resolution generation.
     */
    start(): void;

    /**
     * Discovers supported Bluesky targets inside a bounded connected region.
     *
     * @param root - Region inserted or initially processed.
     */
    inspect(root: ParentNode): void;

    /**
     * Re-evaluates exact sources affected by structural or presentation changes.
     *
     * @param sources - Exact potential source elements.
     */
    inspectSources(sources: readonly Element[]): void;

    /**
     * Releases pending and resolved state covered by one detached region.
     *
     * @param root - Detached document region.
     */
    release(root: ParentNode): void;

    /**
     * Cancels the active generation and releases every retained lookup state.
     */
    stop(): void;
}

/**
 * Splits ordered values into bounded public API batches.
 *
 * @param values - Ordered unique values to split.
 * @param size - Maximum number of values per batch.
 *
 * @returns - Ordered non-empty batches.
 */
function chunk<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
    const batches: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        batches.push(values.slice(index, index + size));
    }
    return batches;
}

/**
 * Checks whether two descriptors retain the exact same DOM and identity association.
 *
 * @param left - Earlier descriptor.
 * @param right - Current descriptor.
 *
 * @returns - Whether a cached resolution remains applicable.
 */
function descriptorsMatch(
    left: BlueskyRelativeTarget,
    right: BlueskyRelativeTarget,
): boolean {
    return left.source === right.source
        && left.target === right.target
        && left.role === right.role
        && left.outerIdentity.key === right.outerIdentity.key
        && left.fingerprint === right.fingerprint;
}

/**
 * Mutable implementation isolated behind the small coordinator lifecycle.
 */
class DocumentBlueskyCoordinator implements BlueskyCoordinator {
    /**
     * Synchronous source rule reading only current weak resolution state.
     */
    readonly rule: TimestampSourceRule;

    /**
     * Whether this coordinator currently accepts discovery work.
     */
    private active = false;

    /**
     * Monotonic lifecycle generation used to reject late asynchronous settlements.
     */
    private generation = 0;

    /**
     * Cancellation owner for the current document generation.
     */
    private abortController: AbortController | undefined;

    /**
     * Latest unresolved structural descriptor for each connected source.
     */
    private readonly pending = new Map<Element, BlueskyRelativeTarget>();

    /**
     * Latest descriptor for every connected source, including resolved and failed sources.
     */
    private readonly tracked = new Map<Element, BlueskyRelativeTarget>();

    /**
     * Successful actor-to-DID results scoped to the current document generation.
     */
    private readonly actorCache = new Map<string, string>();

    /**
     * Successful AT-URI post results scoped to the current document generation.
     */
    private readonly postCache = new Map<string, BlueskyPostRecord>();

    /**
     * Actors settled once, including missing and failed results, to prevent retries.
     */
    private readonly attemptedActors = new Set<string>();

    /**
     * Post URIs settled once, including missing and failed results, to prevent retries.
     */
    private readonly attemptedPosts = new Set<string>();

    /**
     * Current trusted timestamp resolution keyed weakly by page-owned source.
     */
    private resolutions = new WeakMap<Element, ResolvedBlueskyTarget>();

    /**
     * Sources whose rule extraction result changed during the current drain.
     */
    private readonly changedSources = new Set<Element>();

    /**
     * Whether one asynchronous resolution drain currently owns the queues.
     */
    private running = false;

    /**
     * Whether a microtask has already been queued for the active generation.
     */
    private drainScheduled = false;

    /**
     * Captures one document's network and reconciliation dependencies.
     *
     * @param input - Document-local coordinator dependencies.
     */
    constructor(private readonly input: BlueskyCoordinatorInput) {
        this.rule = createBlueskyAdapter((source) => this.resolutions.get(source));
    }

    /**
     * Begins a fresh document-local resolution generation.
     */
    start(): void {
        if (this.active || !matchesBlueskyUrl(this.input.url)) {
            return;
        }
        this.generation += 1;
        this.active = true;
        this.abortController = new AbortController();
        this.clearState();
    }

    /**
     * Discovers supported targets in a bounded connected region.
     *
     * @param root - Initial or newly inserted region.
     */
    inspect(root: ParentNode): void {
        if (!this.active || !this.belongsToDocument(root)) {
            return;
        }
        const descriptors = discoverBlueskyRelativeTargets(root);
        for (const descriptor of descriptors) {
            this.track(descriptor);
        }
        if (descriptors.length > 0) {
            this.scheduleDrain();
        }
    }

    /**
     * Re-evaluates exact potentially changed source elements.
     *
     * @param sources - Exact source candidates affected by mutations.
     */
    inspectSources(sources: readonly Element[]): void {
        if (!this.active) {
            return;
        }
        let changed = false;
        for (const source of new Set(sources)) {
            if (source.ownerDocument === this.input.document && source.isConnected) {
                const descriptor = describeBlueskySource(source, this.tracked.has(source));
                if (descriptor) {
                    this.track(descriptor);
                } else {
                    this.tracked.delete(source);
                    this.pending.delete(source);
                    this.clearResolution(source);
                }
                changed = true;
            }
        }
        if (changed) {
            this.pruneLookupState();
            this.scheduleDrain();
        }
    }

    /**
     * Releases pending and weak resolution state covered by a detached root.
     *
     * @param root - Detached document region.
     */
    release(root: ParentNode): void {
        const removedOuterIdentities = new Set<string>();
        for (const source of this.tracked.keys()) {
            if (root === source || (root as Node).contains(source)) {
                const descriptor = this.tracked.get(source);
                if (descriptor?.role === BLUESKY_TARGET_ROLE.POST) {
                    removedOuterIdentities.add(descriptor.outerIdentity.key);
                }
                this.tracked.delete(source);
                this.pending.delete(source);
            }
        }
        if ((root as Node).nodeType === 1) {
            const element = root as Element;
            this.resolutions.delete(element);
            this.changedSources.delete(element);
        }
        for (const element of root.querySelectorAll('*')) {
            this.resolutions.delete(element);
            this.changedSources.delete(element);
        }
        let dependenciesChanged = false;
        for (const [source, descriptor] of [...this.tracked]) {
            if (
                descriptor.role === BLUESKY_TARGET_ROLE.QUOTE
                && removedOuterIdentities.has(descriptor.outerIdentity.key)
            ) {
                const current = describeBlueskySource(source, true);
                if (current) {
                    this.track(current);
                } else {
                    this.tracked.delete(source);
                    this.pending.delete(source);
                    this.clearResolution(source);
                }
                dependenciesChanged = true;
            }
        }
        this.pruneLookupState();
        if (dependenciesChanged) {
            this.flushChangedSources();
            this.scheduleDrain();
        }
    }

    /**
     * Cancels the active generation and releases all document-local state.
     */
    stop(): void {
        if (!this.active) {
            return;
        }
        this.active = false;
        this.generation += 1;
        this.abortController?.abort();
        this.abortController = undefined;
        this.clearState();
    }

    /**
     * Clears every mutable collection while retaining the stable source rule object.
     */
    private clearState(): void {
        this.pending.clear();
        this.tracked.clear();
        this.actorCache.clear();
        this.postCache.clear();
        this.attemptedActors.clear();
        this.attemptedPosts.clear();
        this.changedSources.clear();
        this.resolutions = new WeakMap<Element, ResolvedBlueskyTarget>();
        this.running = false;
        this.drainScheduled = false;
    }

    /**
     * Checks whether a bounded root belongs to the owned document.
     *
     * @param root - Region considered for discovery or release.
     *
     * @returns - Whether the root belongs to the active document.
     */
    private belongsToDocument(root: ParentNode): boolean {
        return root === this.input.document
            || (root as Node).ownerDocument === this.input.document;
    }

    /**
     * Retains the latest descriptor and invalidates a structurally stale resolution.
     *
     * @param descriptor - Current connected source descriptor.
     */
    private track(descriptor: BlueskyRelativeTarget): void {
        if (
            descriptor.source.ownerDocument !== this.input.document
            || !descriptor.source.isConnected
        ) {
            return;
        }
        const resolution = this.resolutions.get(descriptor.source);
        if (
            resolution
            && (
                resolution.target !== descriptor.target
                || resolution.fingerprint !== descriptor.fingerprint
            )
        ) {
            this.clearResolution(descriptor.source);
        }
        this.tracked.set(descriptor.source, descriptor);
        this.pending.set(descriptor.source, descriptor);
    }

    /**
     * Evicts lookup state that is no longer referenced by a connected tracked source.
     */
    private pruneLookupState(): void {
        const descriptors = [...this.tracked.values()].filter((descriptor) => {
            return descriptor.source.ownerDocument === this.input.document
                && descriptor.source.isConnected;
        });
        const actors = new Set(descriptors.map(({ outerIdentity }) => outerIdentity.actor));
        for (const actor of this.actorCache.keys()) {
            if (!actors.has(actor)) {
                this.actorCache.delete(actor);
            }
        }
        for (const actor of this.attemptedActors) {
            if (!actors.has(actor)) {
                this.attemptedActors.delete(actor);
            }
        }
        const postUris = new Set(descriptors.flatMap((descriptor) => {
            const uri = this.getPostUri(descriptor);
            return uri ? [uri] : [];
        }));
        for (const uri of this.postCache.keys()) {
            if (!postUris.has(uri)) {
                this.postCache.delete(uri);
            }
        }
        for (const uri of this.attemptedPosts) {
            if (!postUris.has(uri)) {
                this.attemptedPosts.delete(uri);
            }
        }
    }

    /**
     * Checks whether a connected tracked source still references one public actor.
     *
     * @param actor - Normalized handle or DID queued for lookup.
     *
     * @returns - Whether the actor is still needed by this document.
     */
    private isActorReferenced(actor: string): boolean {
        return [...this.tracked.values()].some((descriptor) => {
            return descriptor.source.ownerDocument === this.input.document
                && descriptor.source.isConnected
                && descriptor.outerIdentity.actor === actor;
        });
    }

    /**
     * Checks whether a connected tracked source still resolves to one post URI.
     *
     * @param uri - Canonical AT post URI queued for lookup.
     *
     * @returns - Whether the post remains needed by this document.
     */
    private isPostReferenced(uri: string): boolean {
        return [...this.tracked.values()].some((descriptor) => {
            return descriptor.source.ownerDocument === this.input.document
                && descriptor.source.isConnected
                && this.getPostUri(descriptor) === uri;
        });
    }

    /**
     * Deletes one cached source resolution and schedules exact-source restoration.
     *
     * @param source - Current page-owned source.
     */
    private clearResolution(source: Element): void {
        if (this.resolutions.delete(source)) {
            this.changedSources.add(source);
        }
    }

    /**
     * Queues one coalesced microtask drain for the active generation.
     */
    private scheduleDrain(): void {
        if (!this.active || this.running || this.drainScheduled) {
            return;
        }
        const { generation } = this;
        this.drainScheduled = true;
        queueMicrotask(() => {
            if (!this.isCurrentGeneration(generation)) {
                return;
            }
            this.drainScheduled = false;
            void this.drain(generation);
        });
    }

    /**
     * Checks whether asynchronous work still belongs to the active document generation.
     *
     * @param generation - Generation captured before awaiting external work.
     *
     * @returns - Whether the work may still update current state.
     */
    private isCurrentGeneration(generation: number): boolean {
        return this.active && this.generation === generation;
    }

    /**
     * Resolves all currently actionable actor and post work before publishing sources.
     *
     * @param generation - Active generation captured by the scheduled drain.
     */
    private async drain(generation: number): Promise<void> {
        if (!this.isCurrentGeneration(generation) || this.running) {
            return;
        }
        const signal = this.abortController?.signal;
        if (!signal) {
            return;
        }
        this.running = true;
        const diagnostics: DiagnosticCounts = { failure: 0, partial: 0 };
        try {
            await this.resolveActors(generation, signal, diagnostics);
            if (!this.isCurrentGeneration(generation)) {
                return;
            }
            this.pruneLookupState();
            await this.resolvePosts(generation, signal, diagnostics);
            if (!this.isCurrentGeneration(generation)) {
                return;
            }
            this.publishPending();
            this.pruneLookupState();
            this.emitDiagnostics(diagnostics);
        } finally {
            if (this.isCurrentGeneration(generation)) {
                this.running = false;
                this.flushChangedSources();
                if (this.pending.size > 0) {
                    this.scheduleDrain();
                }
            }
        }
    }

    /**
     * Resolves every unique actionable actor in batches of at most 25.
     *
     * @param generation - Active lifecycle generation.
     * @param signal - Active cancellation signal.
     * @param diagnostics - Mutable finite event counts for this drain.
     */
    private async resolveActors(
        generation: number,
        signal: AbortSignal,
        diagnostics: DiagnosticCounts,
    ): Promise<void> {
        const actors = new Set(
            [...this.pending.values()].map(({ outerIdentity }) => outerIdentity.actor),
        );
        for (const actor of actors) {
            if (isValidBlueskyDid(actor)) {
                this.actorCache.set(actor, actor);
            }
        }
        const handles = [...actors].filter((actor) => {
            return !this.actorCache.has(actor)
                && !this.attemptedActors.has(actor);
        });
        for (const queuedBatch of chunk(handles, BLUESKY_BATCH_LIMIT)) {
            const batch = queuedBatch.filter((actor) => {
                return this.isActorReferenced(actor)
                    && !this.actorCache.has(actor)
                    && !this.attemptedActors.has(actor);
            });
            if (batch.length > 0) {
                let result: Awaited<ReturnType<BlueskyAppView['getProfiles']>>;
                try {
                    result = await this.input.appView.getProfiles(batch, signal);
                } catch {
                    result = { status: BLUESKY_LOOKUP_STATUS.FAILURE };
                }
                if (!this.isCurrentGeneration(generation)) {
                    return;
                }
                const liveActors = batch.filter((actor) => this.isActorReferenced(actor));
                for (const actor of liveActors) {
                    this.attemptedActors.add(actor);
                }
                if (result.status === BLUESKY_LOOKUP_STATUS.FAILURE) {
                    diagnostics.failure += liveActors.length;
                    if (liveActors.length > 0) {
                        return;
                    }
                } else {
                    for (const actor of liveActors) {
                        const matches = result.records.filter((record) => record.actor === actor);
                        const match = matches.length === 1 ? matches[0] : undefined;
                        if (match) {
                            this.actorCache.set(actor, match.did);
                        } else {
                            diagnostics.partial += 1;
                        }
                    }
                }
            }
        }
    }

    /**
     * Collects an outer post URI for a descriptor whose actor has resolved.
     *
     * @param descriptor - Current pending descriptor.
     *
     * @returns - Resolved outer AT post URI, or null while actor resolution is unavailable.
     */
    private getPostUri(descriptor: BlueskyRelativeTarget): string | null {
        const did = this.actorCache.get(descriptor.outerIdentity.actor);
        return did
            ? createBlueskyPostUri(did, descriptor.outerIdentity.recordKey)
            : null;
    }

    /**
     * Resolves every unique actionable outer post in batches of at most 25.
     *
     * @param generation - Active lifecycle generation.
     * @param signal - Active cancellation signal.
     * @param diagnostics - Mutable finite event counts for this drain.
     */
    private async resolvePosts(
        generation: number,
        signal: AbortSignal,
        diagnostics: DiagnosticCounts,
    ): Promise<void> {
        const uris = [...new Set(
            [...this.pending.values()].flatMap((descriptor) => {
                const uri = this.getPostUri(descriptor);
                return uri ? [uri] : [];
            }),
        )].filter((uri) => {
            return !this.postCache.has(uri)
                && !this.attemptedPosts.has(uri);
        });
        for (const queuedBatch of chunk(uris, BLUESKY_BATCH_LIMIT)) {
            const batch = queuedBatch.filter((uri) => {
                return this.isPostReferenced(uri)
                    && !this.postCache.has(uri)
                    && !this.attemptedPosts.has(uri);
            });
            if (batch.length > 0) {
                let result: Awaited<ReturnType<BlueskyAppView['getPosts']>>;
                try {
                    result = await this.input.appView.getPosts(batch, signal);
                } catch {
                    result = { status: BLUESKY_LOOKUP_STATUS.FAILURE };
                }
                if (!this.isCurrentGeneration(generation)) {
                    return;
                }
                const liveUris = batch.filter((uri) => this.isPostReferenced(uri));
                for (const uri of liveUris) {
                    this.attemptedPosts.add(uri);
                }
                if (result.status === BLUESKY_LOOKUP_STATUS.FAILURE) {
                    diagnostics.failure += liveUris.length;
                    if (liveUris.length > 0) {
                        return;
                    }
                } else {
                    for (const uri of liveUris) {
                        const matches = result.records.filter((record) => record.uri === uri);
                        const match = matches.length === 1 ? matches[0] : undefined;
                        if (match) {
                            this.postCache.set(uri, match);
                        } else {
                            diagnostics.partial += 1;
                        }
                    }
                }
            }
        }
    }

    /**
     * Rediscovers one retained descriptor and rejects every changed or detached association.
     *
     * @param descriptor - Descriptor retained before asynchronous work.
     *
     * @returns - Matching current descriptor, or null when stale.
     */
    private getCurrentDescriptor(
        descriptor: BlueskyRelativeTarget,
    ): BlueskyRelativeTarget | null {
        if (
            descriptor.source.ownerDocument !== this.input.document
            || !descriptor.source.isConnected
        ) {
            return null;
        }
        const current = describeBlueskySource(descriptor.source, true);
        return current && descriptorsMatch(descriptor, current) ? current : null;
    }

    /**
     * Publishes only resolutions whose source, target, role, and identity remain current.
     */
    private publishPending(): void {
        for (const [source, descriptor] of [...this.pending]) {
            this.publishDescriptor(source, descriptor);
        }
    }

    /**
     * Publishes one pending descriptor once it is still current and its lookups have resolved.
     *
     * @param source - Source element the descriptor belongs to.
     * @param descriptor - Descriptor retained before asynchronous work.
     */
    private publishDescriptor(source: Element, descriptor: BlueskyRelativeTarget): void {
        const current = this.getCurrentDescriptor(descriptor);
        if (!current) {
            if (this.pending.get(source) === descriptor) {
                this.pending.delete(source);
            }
            if (this.tracked.get(source) === descriptor) {
                this.tracked.delete(source);
            }
            this.clearResolution(source);
            return;
        }
        const { actor } = current.outerIdentity;
        const uri = this.getPostUri(current);
        if (!uri) {
            if (this.attemptedActors.has(actor)) {
                this.pending.delete(source);
                this.clearResolution(source);
            }
            return;
        }
        const post = this.postCache.get(uri);
        if (!post) {
            if (this.attemptedPosts.has(uri)) {
                this.pending.delete(source);
                this.clearResolution(source);
            }
            return;
        }
        const indexedAt = current.role === BLUESKY_TARGET_ROLE.POST
            ? post.indexedAt
            : post.quote?.indexedAt;
        if (!indexedAt) {
            this.pending.delete(source);
            this.clearResolution(source);
            return;
        }
        const previous = this.resolutions.get(source);
        if (
            !previous
            || previous.target !== current.target
            || previous.fingerprint !== current.fingerprint
            || previous.indexedAt !== indexedAt
        ) {
            this.resolutions.set(source, {
                target: current.target,
                fingerprint: current.fingerprint,
                indexedAt,
            });
            this.changedSources.add(source);
        }
        this.pending.delete(source);
    }

    /**
     * Emits at most one sanitized failure and one sanitized partial event per drain.
     *
     * @param counts - Aggregated non-identifying counts.
     */
    private emitDiagnostics(counts: DiagnosticCounts): void {
        try {
            const sink = this.input.getDiagnosticSink();
            if (!sink) {
                return;
            }
            if (counts.failure > 0) {
                sink({
                    category: DIAGNOSTIC_CATEGORY.ERROR,
                    reason: DIAGNOSTIC_REASON.PROCESSING_FAILED,
                    count: Math.min(counts.failure, DIAGNOSTIC_MAX_COUNT),
                });
            }
            if (counts.partial > 0) {
                sink({
                    category: DIAGNOSTIC_CATEGORY.SKIP,
                    reason: DIAGNOSTIC_REASON.CANDIDATE_SKIPPED,
                    count: Math.min(counts.partial, DIAGNOSTIC_MAX_COUNT),
                });
            }
        } catch {
            // Diagnostics are optional and must never affect timestamp processing.
        }
    }

    /**
     * Coalesces changed connected sources into one controller callback for this drain.
     */
    private flushChangedSources(): void {
        const sources = [...this.changedSources].filter((source) => {
            return source.ownerDocument === this.input.document && source.isConnected;
        });
        this.changedSources.clear();
        if (sources.length > 0) {
            this.input.onSourcesChanged(sources);
        }
    }
}

/**
 * Creates one document-local Bluesky resolution coordinator.
 *
 * @param input - Document, AppView, diagnostics, and exact-source callback dependencies.
 *
 * @returns - Inactive coordinator ready for the controller lifecycle.
 */
export function createBlueskyCoordinator(
    input: BlueskyCoordinatorInput,
): BlueskyCoordinator {
    return new DocumentBlueskyCoordinator(input);
}
