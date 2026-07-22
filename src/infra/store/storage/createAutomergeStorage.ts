import { getConflicts, type Doc } from '@automerge/automerge';

import { logger } from '#/infra/logger/appLogger';

import { type StorageAdapter } from './types';

type AutomergeStorageDocId = string;

type AutomergeStorageReadableDoc = {
    readonly [key: string]: unknown;
};

type AutomergeStorageMutableDoc = {
    [key: string]: unknown;
};

type AutomergeStorageMutationInput = {
    docId: AutomergeStorageDocId;
    changeFn: (doc: AutomergeStorageMutableDoc) => void;
    message?: string;
    snapshotTransaction?: object;
};

type AutomergeStoragePort = {
    getSemanticMessage(): string | undefined;
    hasDoc(docId: AutomergeStorageDocId): boolean;
    getDoc(docId: AutomergeStorageDocId): AutomergeStorageReadableDoc | undefined;
    mutateDoc(input: AutomergeStorageMutationInput): void;
    waitForSnapshotTransaction?(snapshotTransaction?: object): Promise<void>;
};

type AutomergeStorageOptions<TData> = {
    /** Optional function to strip ephemeral fields before writing to CRDT. */
    toCrdt?: (value: TData) => Partial<TData>;
    /** Optional function to normalize incoming data on hydrate (e.g. fill missing fields from older schemas). */
    fromCrdt?: (value: TData) => TData;
    /** Replacement projection value when the active document has no slot for this store. */
    hydrateMissing?: () => TData;
    /** Deterministically reconcile concurrent whole-slot values exposed by Automerge. */
    resolveConflicts?: (values: readonly TData[]) => TData;
    /** Reconcile raw concurrent CRDT values before domain decoding when tombstones or schema metadata matter. */
    resolveCrdtConflicts?: (values: readonly unknown[]) => TData;
    /** Mutate a CRDT slot in place so domain entities retain causal identity. */
    mutateCrdt?: (input: { doc: AutomergeStorageMutableDoc; key: string; value: TData }) => void;
    /** Rebase a deferred local value over a newer hydrated value. */
    rebasePending?: (input: {
        baseValue: TData | null;
        pendingValue: TData | null;
        hydratedValue: TData;
    }) => TData | null;
};

type AutomergeStorageWriteContext = {
    readonly commitOwner: object;
    readonly scoped: boolean;
    readonly snapshotTransaction: object | undefined;
};

type PendingAutomergeStorageWrite = {
    readonly abort: () => void;
    readonly commitOwner: object;
    readonly didCommit: () => void;
    readonly didDiscard: () => void;
    readonly docId: AutomergeStorageDocId;
    readonly snapshotTransaction: object | undefined;
    readonly prepare: () => AutomergeStorageMutationInput | null;
};

type ActiveAutomergeStorageTransaction = {
    readonly commitOwner: object;
    readonly snapshotTransaction: object | undefined;
};

type AutomergeStorageTransactionControl = {
    abort(): void;
    commit(): void;
};

type AutomergeStorageTransactionOutcome<Result> =
    | { readonly status: 'returned'; readonly value: Result }
    | {
          readonly status: 'threw';
          readonly error: unknown;
      };

type AutomergeStorageTransactionResult<Result> = AutomergeStorageTransactionControl &
    AutomergeStorageTransactionOutcome<Result>;

class AutomergeStorageFlushError extends Error {
    readonly committedDocumentCount: number;
    readonly failure: unknown;

    constructor(failure: unknown, committedDocumentCount: number) {
        super(failure instanceof Error ? failure.message : 'Failed to flush an Automerge storage write', {
            cause: failure,
        });
        this.name = 'AutomergeStorageFlushError';
        this.committedDocumentCount = committedDocumentCount;
        this.failure = failure;
    }
}

export class AutomergeStorageTransactionCommittedError extends Error {
    constructor(cause: unknown) {
        super('Automerge storage transaction committed before a later document failed', { cause });
        this.name = 'AutomergeStorageTransactionCommittedError';
    }
}

let automergeStoragePort: AutomergeStoragePort | null = null;
const pendingAutomergeStorageWrites = new Set<PendingAutomergeStorageWrite>();
const openAutomergeStorageCommitOwners = new Set<object>();
let activeAutomergeStorageTransaction: ActiveAutomergeStorageTransaction | undefined;

/** One Automerge change is the atomic commit boundary for keys sharing a document and owner. */
function commitAutomergeStorageMutations(mutations: readonly AutomergeStorageMutationInput[]): void {
    const firstMutation = mutations[0];
    if (!firstMutation) {
        return;
    }

    const port = getAutomergeStoragePort();
    if (!port) {
        return;
    }

    const message = mutations.find((mutation) => mutation.message !== undefined)?.message;
    port.mutateDoc({
        docId: firstMutation.docId,
        changeFn: (doc) => {
            for (const mutation of mutations) {
                mutation.changeFn(doc);
            }
        },
        message,
        snapshotTransaction: firstMutation.snapshotTransaction,
    });
}

/** Scope one synchronous action write path to an opaque snapshot transaction. */
export function runWithAutomergeStorageTransaction<Result>(
    snapshotTransaction: object | undefined,
    callback: () => Result
): AutomergeStorageTransactionResult<Result> {
    const previousTransaction = activeAutomergeStorageTransaction;
    const transaction: ActiveAutomergeStorageTransaction = {
        commitOwner: Object.freeze({}),
        snapshotTransaction,
    };
    activeAutomergeStorageTransaction = transaction;
    openAutomergeStorageCommitOwners.add(transaction.commitOwner);
    let terminalState: 'open' | 'committed' | 'aborted' = 'open';
    let outcome: AutomergeStorageTransactionOutcome<Result>;
    try {
        outcome = { status: 'returned', value: callback() };
    } catch (error) {
        outcome = { status: 'threw', error };
    } finally {
        activeAutomergeStorageTransaction = previousTransaction;
    }

    const control: AutomergeStorageTransactionControl = {
        abort(): void {
            if (terminalState !== 'open') {
                return;
            }
            terminalState = 'aborted';
            openAutomergeStorageCommitOwners.delete(transaction.commitOwner);
            for (const pending of [...pendingAutomergeStorageWrites]) {
                if (
                    pending.commitOwner === transaction.commitOwner &&
                    pending.snapshotTransaction === transaction.snapshotTransaction
                ) {
                    pending.abort();
                }
            }
        },
        commit(): void {
            if (terminalState !== 'open') {
                return;
            }
            openAutomergeStorageCommitOwners.delete(transaction.commitOwner);
            try {
                flushMatchingAutomergeStorageWrites(
                    (pending) =>
                        pending.commitOwner === transaction.commitOwner &&
                        pending.snapshotTransaction === transaction.snapshotTransaction
                );
            } catch (error) {
                if (error instanceof AutomergeStorageFlushError && error.committedDocumentCount > 0) {
                    terminalState = 'committed';
                    for (const pending of [...pendingAutomergeStorageWrites]) {
                        if (
                            pending.commitOwner === transaction.commitOwner &&
                            pending.snapshotTransaction === transaction.snapshotTransaction
                        ) {
                            pending.abort();
                        }
                    }
                    throw new AutomergeStorageTransactionCommittedError(error.failure);
                }

                openAutomergeStorageCommitOwners.add(transaction.commitOwner);
                throw error instanceof AutomergeStorageFlushError ? error.failure : error;
            }
            terminalState = 'committed';
        },
    };

    return { ...outcome, ...control };
}

function flushMatchingAutomergeStorageWrites(matches: (pending: PendingAutomergeStorageWrite) => boolean): void {
    let firstError: unknown;
    let committedDocumentCount = 0;
    const groups = new Map<string, Map<object, PendingAutomergeStorageWrite[]>>();

    for (const pending of [...pendingAutomergeStorageWrites]) {
        if (!matches(pending)) {
            continue;
        }
        if (openAutomergeStorageCommitOwners.has(pending.commitOwner)) {
            continue;
        }

        let ownerGroups = groups.get(pending.docId);
        if (!ownerGroups) {
            ownerGroups = new Map();
            groups.set(pending.docId, ownerGroups);
        }

        const ownerWrites = ownerGroups.get(pending.commitOwner);
        if (ownerWrites) {
            ownerWrites.push(pending);
        } else {
            ownerGroups.set(pending.commitOwner, [pending]);
        }
    }

    for (const ownerGroups of groups.values()) {
        for (const writes of ownerGroups.values()) {
            const mutations: AutomergeStorageMutationInput[] = [];
            let preparationFailed = false;
            let preparationUnavailable = false;

            for (const write of writes) {
                try {
                    const mutation = write.prepare();
                    if (mutation) {
                        mutations.push(mutation);
                    } else {
                        preparationUnavailable = true;
                    }
                } catch (error) {
                    preparationFailed = true;
                    firstError ??= error;
                }
            }

            if (preparationFailed) {
                continue;
            }
            if (preparationUnavailable) {
                for (const write of writes) {
                    write.didDiscard();
                }
                continue;
            }

            try {
                commitAutomergeStorageMutations(mutations);
                committedDocumentCount += 1;
                for (const write of writes) {
                    write.didCommit();
                }
            } catch (error) {
                firstError ??= error;
            }
        }
    }

    if (firstError !== undefined) {
        throw new AutomergeStorageFlushError(firstError, committedDocumentCount);
    }
}

function flushAutomergeStorageWriteOwner(write: PendingAutomergeStorageWrite): void {
    flushMatchingAutomergeStorageWrites(
        (pending) =>
            pending.commitOwner === write.commitOwner && pending.snapshotTransaction === write.snapshotTransaction
    );
}

export function flushAutomergeStorageWrites(snapshotTransaction?: object): void {
    flushMatchingAutomergeStorageWrites(
        (pending) => snapshotTransaction === undefined || pending.snapshotTransaction === snapshotTransaction
    );
}

export function configureAutomergeStoragePort(port: AutomergeStoragePort | null): void {
    automergeStoragePort = port;
}

const getAutomergeStoragePort = (): AutomergeStoragePort | null => {
    return automergeStoragePort;
};

export function waitForAutomergeSnapshotTransaction(snapshotTransaction?: object): Promise<void> {
    return getAutomergeStoragePort()?.waitForSnapshotTransaction?.(snapshotTransaction) ?? Promise.resolve();
}

/**
 * A storage adapter that persists store state in an Automerge CRDT document.
 *
 * Each store gets a dedicated key within an Automerge document.
 * Writes go through the automergeRepository, which handles change tracking
 * and sync. Reads come from a fast in-memory cache.
 *
 * Use `toCrdt` to strip ephemeral fields that shouldn't be persisted or
 * synced (e.g. `isPlaying`, `playheadPosition` on the transport store).
 *
 * ## CRDT write batching
 *
 * `set()` updates the in-memory cache immediately (so the UI stays responsive).
 * The actual Automerge `changeDoc()` write is deferred to the next animation
 * frame via `requestAnimationFrame`. This collapses rapid burst updates (knob
 * sweeps, fader drags, clip moves) into a single CRDT mutation per frame.
 *
 * ## Automerge v3 constraints handled here
 *
 * Values read from an Automerge doc are Proxy objects. Automerge rejects
 * re-inserting a proxy into a `change()` call. It also rejects `undefined`
 * values. `toDocSafe()` strips both via a JSON round-trip.
 */
export const createAutomergeStorage = <TData>(
    docId: AutomergeStorageDocId,
    key: string,
    options?: AutomergeStorageOptions<TData>
): StorageAdapter<TData> => {
    const toCrdt = options?.toCrdt;
    const fromCrdt = options?.fromCrdt;
    const hydrateMissing = options?.hydrateMissing;
    const resolveConflicts = options?.resolveConflicts;
    const resolveCrdtConflicts = options?.resolveCrdtConflicts;
    const mutateCrdt = options?.mutateCrdt;
    const rebasePending = options?.rebasePending;
    type AdapterPendingWrite = {
        baseValue: TData | null;
        message: string | undefined;
        rafId: number | null;
        revision: number;
        scoped: boolean;
        value: TData | null;
        write: PendingAutomergeStorageWrite;
    };
    let cachedValue: TData | null = null;
    let committedCacheValue: TData | null = null;
    let committedCacheRevision = 0;
    let cachedRevision = 0;
    let nextRevision = 0;
    const pendingWritesByOwner = new Map<object, AdapterPendingWrite>();
    let unscopedCommitOwner: object | undefined;
    /**
     * §119.2 — Cached canonical JSON of the last hydrate. Lets hydrate()
     * skip re-stringifying cachedValue on every sync message when the
     * incoming doc slot hasn't changed (hot path during multi-peer
     * collaboration).
     */
    let lastHydratedJson: string | null = null;

    const toDocSafe = <TValue>(value: TValue): TValue => JSON.parse(JSON.stringify(value)) as TValue;

    const createMutation = (
        value: TData | null,
        message?: string,
        snapshotTransaction?: object
    ): AutomergeStorageMutationInput | null => {
        const port = getAutomergeStoragePort();
        if (!port) {
            return null;
        }

        if (!port.hasDoc(docId)) {
            return null;
        }

        const crdtValue = value !== null && toCrdt ? toCrdt(value) : value;

        return {
            docId,
            changeFn: (doc) => {
                if (crdtValue === null) {
                    delete doc[key];
                } else if (mutateCrdt) {
                    mutateCrdt({ doc, key, value: toDocSafe(crdtValue as TData) });
                } else {
                    doc[key] = toDocSafe(crdtValue);
                }
            },
            message,
            snapshotTransaction,
        };
    };

    const writeToCrdt = (value: TData | null, message?: string, snapshotTransaction?: object): void => {
        const mutation = createMutation(value, message, snapshotTransaction);
        if (mutation) {
            commitAutomergeStorageMutations([mutation]);
        }
    };

    const getSemanticMessage = (): string | undefined => {
        return getAutomergeStoragePort()?.getSemanticMessage();
    };

    const getWriteContext = (): AutomergeStorageWriteContext => {
        if (activeAutomergeStorageTransaction) {
            return { ...activeAutomergeStorageTransaction, scoped: true };
        }

        unscopedCommitOwner ??= Object.freeze({});
        return {
            commitOwner: unscopedCommitOwner,
            scoped: false,
            snapshotTransaction: undefined,
        };
    };

    const preparePendingWrite = (pending: AdapterPendingWrite): AutomergeStorageMutationInput | null => {
        if (pendingWritesByOwner.get(pending.write.commitOwner) !== pending) {
            return null;
        }
        if (pending.rafId !== null) {
            cancelAnimationFrame(pending.rafId);
            pending.rafId = null;
        }
        // Superseded-write guard for UNSCOPED pendings: an rAF-deferred write
        // whose last set() predates the newest committed value would, on its
        // late flush, revert the CRDT slot — and recordCommittedWrite would
        // then surface the older value as the cache (the GrooveDropTarget
        // cache race: a pre-save write's slow rAF flush landed after the
        // save's scoped commit and dropped the just-committed template).
        // Scoped pendings are exempt: transaction commit order is deliberate
        // terminal order (compensating transactions legitimately commit older
        // values last).
        if (!pending.scoped && pending.revision < committedCacheRevision) {
            return null;
        }
        return createMutation(pending.value, pending.message, pending.write.snapshotTransaction);
    };

    const releasePendingWrite = (pending: AdapterPendingWrite): boolean => {
        if (pendingWritesByOwner.get(pending.write.commitOwner) !== pending) {
            return false;
        }
        if (pending.rafId !== null) {
            cancelAnimationFrame(pending.rafId);
            pending.rafId = null;
        }
        pendingAutomergeStorageWrites.delete(pending.write);
        pendingWritesByOwner.delete(pending.write.commitOwner);
        if (unscopedCommitOwner === pending.write.commitOwner) {
            unscopedCommitOwner = undefined;
        }
        return true;
    };

    const abortPendingWrite = (pending: AdapterPendingWrite): void => {
        if (!releasePendingWrite(pending)) {
            return;
        }
        recomputeCachedValue();
    };

    const recomputeCachedValue = (): void => {
        let visibleValue = committedCacheValue;
        let visibleRevision = committedCacheRevision;
        for (const remaining of pendingWritesByOwner.values()) {
            if (remaining.revision > visibleRevision) {
                visibleValue = remaining.value;
                visibleRevision = remaining.revision;
            }
        }
        cachedValue = visibleValue;
        cachedRevision = visibleRevision;
    };

    const recordCommittedWrite = (pending: AdapterPendingWrite): void => {
        if (!releasePendingWrite(pending)) {
            return;
        }
        committedCacheValue = pending.value;
        committedCacheRevision = ++nextRevision;
        for (const remaining of pendingWritesByOwner.values()) {
            remaining.baseValue = pending.value;
        }
        recomputeCachedValue();
    };

    const createPendingWrite = (context: AutomergeStorageWriteContext): AdapterPendingWrite => {
        // Capture the semantic context while the action is still active. The
        // first write in this adapter/action group owns its coalesced message.
        let pending: AdapterPendingWrite | undefined;
        const getPending = (): AdapterPendingWrite => {
            if (!pending) {
                throw new Error('Automerge storage pending write was not initialized');
            }
            return pending;
        };
        const write: PendingAutomergeStorageWrite = {
            abort: () => abortPendingWrite(getPending()),
            commitOwner: context.commitOwner,
            didCommit: () => recordCommittedWrite(getPending()),
            didDiscard: () => releasePendingWrite(getPending()),
            docId,
            prepare: () => preparePendingWrite(getPending()),
            snapshotTransaction: context.snapshotTransaction,
        };
        pending = {
            baseValue: cachedValue,
            message: getSemanticMessage(),
            rafId: null,
            revision: cachedRevision,
            scoped: context.scoped,
            value: cachedValue,
            write,
        };
        pendingWritesByOwner.set(context.commitOwner, pending);
        pendingAutomergeStorageWrites.add(write);
        pending.rafId = requestAnimationFrame(() => {
            pending.rafId = null;
            try {
                flushAutomergeStorageWriteOwner(write);
            } catch (error) {
                logger.warn('[AutomergeStorage] CRDT write failed, in-memory state still updated:', error);
            }
        });
        return pending;
    };

    return {
        get(): TData | null {
            return cachedValue;
        },

        set(value: TData | null): void {
            const context = getWriteContext();
            const pending = pendingWritesByOwner.get(context.commitOwner) ?? createPendingWrite(context);
            cachedValue = value;
            cachedRevision = ++nextRevision;
            pending.value = value;
            pending.revision = cachedRevision;
        },

        clear(): void {
            const context = getWriteContext();
            const pending = pendingWritesByOwner.get(context.commitOwner) ?? createPendingWrite(context);
            cachedValue = null;
            cachedRevision = ++nextRevision;
            pending.value = null;
            pending.revision = cachedRevision;
        },

        isSupported(): boolean {
            return true;
        },

        hydrate(): boolean {
            const doc = getAutomergeStoragePort()?.getDoc(docId);
            if (!doc) {
                return false;
            }

            const value = doc[key];
            if (value !== undefined) {
                // §119.1 — single strip pass via one JSON round-trip (the
                // Automerge proxy deref + undefined strip are unavoidable).
                // §119.2 — compare incoming against cached incoming rather
                // than re-stringifying cachedValue; 2 JSON ops per hydrate
                // instead of 3–4.
                let incomingValues: readonly unknown[] = [value];
                if (resolveConflicts || resolveCrdtConflicts) {
                    const conflicts = getConflicts(doc as Doc<AutomergeStorageReadableDoc>, key);
                    if (conflicts) {
                        incomingValues = Object.entries(conflicts)
                            .sort(([leftActor], [rightActor]) => {
                                if (leftActor < rightActor) {
                                    return -1;
                                }
                                if (leftActor > rightActor) {
                                    return 1;
                                }
                                return 0;
                            })
                            .map(([, conflictValue]) => conflictValue);
                    }
                }
                const incomingJson = JSON.stringify(incomingValues);
                if (incomingJson === lastHydratedJson) {
                    return false;
                }
                const rawValues = JSON.parse(incomingJson) as unknown[];
                const normalizedValues = fromCrdt
                    ? rawValues.map((rawValue) => fromCrdt(rawValue as TData))
                    : (rawValues as TData[]);
                const firstValue = normalizedValues[0];
                if (firstValue === undefined) {
                    return false;
                }
                let crdtData: TData = firstValue;
                if (resolveCrdtConflicts && rawValues.length > 1) {
                    crdtData = resolveCrdtConflicts(rawValues);
                } else if (resolveConflicts && normalizedValues.length > 1) {
                    crdtData = resolveConflicts(normalizedValues);
                }

                committedCacheValue = crdtData;
                committedCacheRevision = ++nextRevision;

                const visiblePending = [...pendingWritesByOwner.values()].find(
                    (pending) => pending.revision === cachedRevision
                );
                if (visiblePending) {
                    let rebasedValue = visiblePending.value;
                    if (rebasePending) {
                        rebasedValue = rebasePending({
                            baseValue: visiblePending.baseValue,
                            pendingValue: visiblePending.value,
                            hydratedValue: crdtData,
                        });
                    } else if (
                        toCrdt &&
                        visiblePending.value !== null &&
                        typeof visiblePending.value === 'object' &&
                        typeof crdtData === 'object' &&
                        crdtData !== null
                    ) {
                        rebasedValue = { ...visiblePending.value, ...crdtData };
                    }
                    cachedValue = rebasedValue;
                    cachedRevision = ++nextRevision;
                    visiblePending.value = rebasedValue;
                    visiblePending.revision = cachedRevision;
                } else if (toCrdt && cachedValue !== null && typeof crdtData === 'object' && crdtData !== null) {
                    cachedValue = { ...cachedValue, ...crdtData };
                    cachedRevision = committedCacheRevision;
                    committedCacheValue = cachedValue;
                } else {
                    cachedValue = crdtData;
                    cachedRevision = committedCacheRevision;
                }
                lastHydratedJson = incomingJson;
                return true;
            }

            if (cachedValue !== null) {
                if (hydrateMissing) {
                    const missing_value = toDocSafe(hydrateMissing());
                    if (JSON.stringify(cachedValue) === JSON.stringify(missing_value)) {
                        return false;
                    }
                    cachedValue = missing_value;
                    committedCacheValue = missing_value;
                    committedCacheRevision = ++nextRevision;
                    cachedRevision = committedCacheRevision;
                    lastHydratedJson = null;
                    return true;
                }
                writeToCrdt(cachedValue);
            }

            return false;
        },
    };
};
