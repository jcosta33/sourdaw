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
    readonly snapshotTransaction: object | undefined;
};

type PendingAutomergeStorageWrite = {
    readonly abort: () => void;
    readonly commitOwner: object;
    readonly docId: AutomergeStorageDocId;
    readonly snapshotTransaction: object | undefined;
    readonly flush: () => AutomergeStorageMutationInput | null;
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
            terminalState = 'committed';
            openAutomergeStorageCommitOwners.delete(transaction.commitOwner);
            flushMatchingAutomergeStorageWrites(
                (pending) =>
                    pending.commitOwner === transaction.commitOwner &&
                    pending.snapshotTransaction === transaction.snapshotTransaction
            );
        },
    };

    return { ...outcome, ...control };
}

function flushMatchingAutomergeStorageWrites(matches: (pending: PendingAutomergeStorageWrite) => boolean): void {
    let firstError: unknown;
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

            for (const write of writes) {
                try {
                    const mutation = write.flush();
                    if (mutation) {
                        mutations.push(mutation);
                    } else {
                        preparationFailed = true;
                    }
                } catch (error) {
                    preparationFailed = true;
                    firstError ??= error;
                }
            }

            if (preparationFailed) {
                continue;
            }

            try {
                commitAutomergeStorageMutations(mutations);
            } catch (error) {
                firstError ??= error;
            }
        }
    }

    if (firstError !== undefined) {
        throw firstError instanceof Error
            ? firstError
            : new Error('Failed to flush an Automerge storage write', { cause: firstError });
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
    let cachedValue: TData | null = null;
    let pendingBaseValue: TData | null = null;
    let pendingValue: TData | null = null;
    let rafId: number | null = null;
    let pendingMessage: string | undefined;
    let pendingWrite: PendingAutomergeStorageWrite | null = null;
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
            return activeAutomergeStorageTransaction;
        }

        unscopedCommitOwner ??= Object.freeze({});
        return {
            commitOwner: unscopedCommitOwner,
            snapshotTransaction: undefined,
        };
    };

    const flushPendingWrite = (write: PendingAutomergeStorageWrite): AutomergeStorageMutationInput | null => {
        if (pendingWrite !== write) {
            return null;
        }
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        pendingAutomergeStorageWrites.delete(write);
        pendingWrite = null;
        if (unscopedCommitOwner === write.commitOwner) {
            unscopedCommitOwner = undefined;
        }
        const message = pendingMessage;
        pendingMessage = undefined;
        const value = pendingValue;
        pendingBaseValue = null;
        pendingValue = null;
        return createMutation(value, message, write.snapshotTransaction);
    };

    const abortPendingWrite = (write: PendingAutomergeStorageWrite): void => {
        if (pendingWrite !== write) {
            return;
        }
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        pendingAutomergeStorageWrites.delete(write);
        pendingWrite = null;
        cachedValue = pendingBaseValue;
        pendingBaseValue = null;
        pendingValue = null;
        pendingMessage = undefined;
    };

    const preparePendingWrite = (context: AutomergeStorageWriteContext): void => {
        if (
            pendingWrite &&
            (pendingWrite.commitOwner !== context.commitOwner ||
                pendingWrite.snapshotTransaction !== context.snapshotTransaction)
        ) {
            flushAutomergeStorageWriteOwner(pendingWrite);
        }
    };

    const schedulePendingWrite = (context: AutomergeStorageWriteContext): void => {
        if (pendingWrite) {
            return;
        }

        // Capture the semantic context while the action is still active. The
        // first write in this adapter/action group owns its coalesced message.
        pendingMessage = getSemanticMessage();
        const write: PendingAutomergeStorageWrite = {
            abort: () => abortPendingWrite(write),
            commitOwner: context.commitOwner,
            docId,
            snapshotTransaction: context.snapshotTransaction,
            flush: () => flushPendingWrite(write),
        };
        pendingWrite = write;
        pendingAutomergeStorageWrites.add(write);
        rafId = requestAnimationFrame(() => {
            rafId = null;
            try {
                flushAutomergeStorageWriteOwner(write);
            } catch (error) {
                logger.warn('[AutomergeStorage] CRDT write failed, in-memory state still updated:', error);
            }
        });
    };

    return {
        get(): TData | null {
            return cachedValue;
        },

        set(value: TData | null): void {
            const context = getWriteContext();
            preparePendingWrite(context);
            if (!pendingWrite) {
                pendingBaseValue = cachedValue;
            }
            cachedValue = value;
            pendingValue = value;
            schedulePendingWrite(context);
        },

        clear(): void {
            const context = getWriteContext();
            preparePendingWrite(context);
            if (!pendingWrite) {
                pendingBaseValue = cachedValue;
            }
            cachedValue = null;
            pendingValue = null;
            schedulePendingWrite(context);
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

                if (pendingWrite) {
                    let rebasedValue = pendingValue;
                    if (rebasePending) {
                        rebasedValue = rebasePending({
                            baseValue: pendingBaseValue,
                            pendingValue,
                            hydratedValue: crdtData,
                        });
                    } else if (
                        toCrdt &&
                        pendingValue !== null &&
                        typeof pendingValue === 'object' &&
                        typeof crdtData === 'object' &&
                        crdtData !== null
                    ) {
                        rebasedValue = { ...pendingValue, ...crdtData };
                    }
                    cachedValue = rebasedValue;
                    pendingValue = rebasedValue;
                } else if (toCrdt && cachedValue !== null && typeof crdtData === 'object' && crdtData !== null) {
                    cachedValue = { ...cachedValue, ...crdtData };
                } else {
                    cachedValue = crdtData;
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
                    lastHydratedJson = null;
                    return true;
                }
                writeToCrdt(cachedValue);
            }

            return false;
        },
    };
};
