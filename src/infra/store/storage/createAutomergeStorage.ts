import { type DocId } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';
import { automergeRepository } from '#/modules/CrdtDocument/repositories/automergeRepository';
import { getSemanticContext } from '#/modules/CrdtDocument/useCases/semanticChangeContext';
import { type StorageAdapter } from './types';

type AutomergeStorageOptions<TData> = {
    /** Optional function to strip ephemeral fields before writing to CRDT. */
    toCrdt?: (value: TData) => Partial<TData>;
};

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
    docId: DocId,
    key: string,
    options?: AutomergeStorageOptions<TData>
): StorageAdapter<TData> => {
    const toCrdt = options?.toCrdt;
    let cachedValue: TData | null = null;
    let rafId: number | null = null;

    const toDocSafe = <TValue>(value: TValue): TValue => JSON.parse(JSON.stringify(value));

    const writeToCrdt = (value: TData | null): void => {
        if (!automergeRepository.hasDoc(docId)) {
            return;
        }

        const crdtValue = value !== null && toCrdt ? toCrdt(value) : value;
        const semanticCtx = getSemanticContext();
        const message = semanticCtx?.message;

        automergeRepository.changeDoc(
            docId,
            (doc: Record<string, unknown>) => {
                if (crdtValue === null) {
                    delete doc[key];
                } else {
                    doc[key] = toDocSafe(crdtValue);
                }
            },
            message
        );
    };

    return {
        get(): TData | null {
            return cachedValue;
        },

        set(value: TData | null): void {
            cachedValue = value;

            if (rafId === null) {
                rafId = requestAnimationFrame(() => {
                    rafId = null;
                    try {
                        writeToCrdt(cachedValue);
                    } catch (error) {
                        console.error('[AutomergeStorage] CRDT write failed, in-memory state still updated:', error);
                    }
                });
            }
        },

        clear(): void {
            cachedValue = null;
            // Flush immediately on clear rather than batching
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            try {
                writeToCrdt(null);
            } catch {
                // Best-effort
            }
        },

        isSupported(): boolean {
            return true;
        },

        hydrate(): boolean {
            const doc = automergeRepository.getDoc(docId);
            if (!doc) {
                return false;
            }

            const value = (doc as Record<string, unknown>)[key];
            if (value !== undefined) {
                const incomingJson = JSON.stringify(value);
                const crdtData = JSON.parse(incomingJson) as TData;
                const beforeJson = JSON.stringify(cachedValue);

                if (toCrdt && cachedValue !== null && typeof crdtData === 'object' && crdtData !== null) {
                    cachedValue = { ...cachedValue, ...crdtData };
                    return JSON.stringify(cachedValue) !== beforeJson;
                } else {
                    cachedValue = crdtData;
                    return incomingJson !== beforeJson;
                }
            }

            if (cachedValue !== null) {
                writeToCrdt(cachedValue);
            }

            return false;
        },
    };
};
