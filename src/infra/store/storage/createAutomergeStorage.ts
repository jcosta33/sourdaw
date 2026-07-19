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
};

type AutomergeStorageWriteContext = {
    readonly commitOwner: object;
    readonly snapshotTransaction: object | undefined;
};

type PendingAutomergeStorageWrite = {
    readonly commitOwner: object;
    readonly docId: AutomergeStorageDocId;
    readonly snapshotTransaction: object | undefined;
    readonly flush: () => AutomergeStorageMutationInput | null;
};

type ActiveAutomergeStorageTransaction = {
    readonly commitOwner: object;
    readonly snapshotTransaction: object | undefined;
};

let automergeStoragePort: AutomergeStoragePort | null = null;
const pendingAutomergeStorageWrites = new Set<PendingAutomergeStorageWrite>();
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

export function createAutomergeStorageCommitScope(snapshotTransaction: object | undefined) {
    const transaction: ActiveAutomergeStorageTransaction = {
        commitOwner: Object.freeze({}),
        snapshotTransaction,
    };

    return function runAutomergeStorageCommit<Result>(callback: () => Result): Result {
        const previousTransaction = activeAutomergeStorageTransaction;
        activeAutomergeStorageTransaction = transaction;
        try {
            return callback();
        } finally {
            activeAutomergeStorageTransaction = previousTransaction;
        }
    };
}

/** Scope one synchronous action write path to an opaque snapshot transaction. */
export function runWithAutomergeStorageTransaction<Result>(
    snapshotTransaction: object | undefined,
    callback: () => Result
): Result {
    const runCommit = createAutomergeStorageCommitScope(snapshotTransaction);
    return runCommit(callback);
}

function flushMatchingAutomergeStorageWrites(matches: (pending: PendingAutomergeStorageWrite) => boolean): void {
    let firstError: unknown;
    const groups = new Map<string, Map<object, PendingAutomergeStorageWrite[]>>();

    for (const pending of [...pendingAutomergeStorageWrites]) {
        if (!matches(pending)) {
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
    let cachedValue: TData | null = null;
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
        return createMutation(cachedValue, message, write.snapshotTransaction);
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
            cachedValue = value;
            schedulePendingWrite(context);
        },

        clear(): void {
            const context = getWriteContext();
            preparePendingWrite(context);
            cachedValue = null;
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
                const incomingJson = JSON.stringify(value);
                if (incomingJson === lastHydratedJson) {
                    return false;
                }
                const rawData = JSON.parse(incomingJson) as TData;
                const crdtData = fromCrdt ? fromCrdt(rawData) : rawData;

                if (toCrdt && cachedValue !== null && typeof crdtData === 'object' && crdtData !== null) {
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
