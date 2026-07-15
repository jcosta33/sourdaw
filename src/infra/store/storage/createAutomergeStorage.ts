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
};

let automergeStoragePort: AutomergeStoragePort | null = null;
type PendingAutomergeStorageWrite = {
    readonly snapshotTransaction: object | undefined;
    readonly flush: () => void;
};

const pendingAutomergeStorageWrites = new Set<PendingAutomergeStorageWrite>();
let activeAutomergeStorageTransaction: object | undefined;

/** Scope one synchronous action write path to an opaque snapshot transaction. */
export function runWithAutomergeStorageTransaction<Result>(
    snapshotTransaction: object | undefined,
    callback: () => Result
): Result {
    const previousTransaction = activeAutomergeStorageTransaction;
    activeAutomergeStorageTransaction = snapshotTransaction;
    try {
        return callback();
    } finally {
        activeAutomergeStorageTransaction = previousTransaction;
    }
}

export function flushAutomergeStorageWrites(snapshotTransaction?: object): void {
    let firstError: unknown;
    for (const pending of [...pendingAutomergeStorageWrites]) {
        if (snapshotTransaction !== undefined && pending.snapshotTransaction !== snapshotTransaction) {
            continue;
        }
        try {
            pending.flush();
        } catch (error) {
            firstError ??= error;
        }
    }
    if (firstError !== undefined) {
        throw firstError instanceof Error
            ? firstError
            : new Error('Failed to flush an Automerge storage write', { cause: firstError });
    }
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
    let cachedValue: TData | null = null;
    let rafId: number | null = null;
    let pendingMessage: string | undefined;
    let pendingWrite: PendingAutomergeStorageWrite | null = null;
    /**
     * §119.2 — Cached canonical JSON of the last hydrate. Lets hydrate()
     * skip re-stringifying cachedValue on every sync message when the
     * incoming doc slot hasn't changed (hot path during multi-peer
     * collaboration).
     */
    let lastHydratedJson: string | null = null;

    const toDocSafe = <TValue>(value: TValue): TValue => JSON.parse(JSON.stringify(value)) as TValue;

    const writeToCrdt = (value: TData | null, message?: string, snapshotTransaction?: object): void => {
        const port = getAutomergeStoragePort();
        if (!port) {
            return;
        }

        if (!port.hasDoc(docId)) {
            return;
        }

        const crdtValue = value !== null && toCrdt ? toCrdt(value) : value;

        port.mutateDoc({
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
        });
    };

    const getSemanticMessage = (): string | undefined => {
        return getAutomergeStoragePort()?.getSemanticMessage();
    };

    const flushPendingWrite = (write: PendingAutomergeStorageWrite): void => {
        if (pendingWrite !== write) {
            return;
        }
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        pendingAutomergeStorageWrites.delete(write);
        pendingWrite = null;
        const message = pendingMessage;
        pendingMessage = undefined;
        writeToCrdt(cachedValue, message, write.snapshotTransaction);
    };

    const discardPendingWrite = (): void => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (pendingWrite) {
            pendingAutomergeStorageWrites.delete(pendingWrite);
            pendingWrite = null;
        }
        pendingMessage = undefined;
    };

    return {
        get(): TData | null {
            return cachedValue;
        },

        set(value: TData | null): void {
            const snapshotTransaction = activeAutomergeStorageTransaction;
            if (pendingWrite && pendingWrite.snapshotTransaction !== snapshotTransaction) {
                flushPendingWrite(pendingWrite);
            }
            cachedValue = value;

            if (!pendingWrite) {
                // Capture the semantic context now, while the caller's context
                // is live. The actual write is deferred to the next animation
                // frame; by the time it fires, `executeAppAction` has already
                // cleared the context in its `finally`, so reading it inside the
                // RAF would always see `null` and record `message: undefined`.
                // The first `set()` of a frame owns the coalesced write's message.
                pendingMessage = getSemanticMessage();
                const write: PendingAutomergeStorageWrite = {
                    snapshotTransaction,
                    flush: () => flushPendingWrite(write),
                };
                pendingWrite = write;
                pendingAutomergeStorageWrites.add(write);
                rafId = requestAnimationFrame(() => {
                    rafId = null;
                    try {
                        flushPendingWrite(write);
                    } catch (error) {
                        logger.warn('[AutomergeStorage] CRDT write failed, in-memory state still updated:', error);
                    }
                });
            }
        },

        clear(): void {
            const snapshotTransaction = activeAutomergeStorageTransaction;
            if (pendingWrite && pendingWrite.snapshotTransaction !== snapshotTransaction) {
                flushPendingWrite(pendingWrite);
            }
            cachedValue = null;
            // Flush immediately on clear rather than batching. The write is
            // synchronous here, so the caller's semantic context (set by
            // `executeAppAction`) is still live and can annotate the change.
            const message = getSemanticMessage();
            discardPendingWrite();
            try {
                writeToCrdt(null, message, snapshotTransaction);
            } catch {
                // Best-effort
            }
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
                writeToCrdt(cachedValue);
            }

            return false;
        },
    };
};
