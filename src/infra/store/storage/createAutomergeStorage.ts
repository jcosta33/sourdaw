import { logger } from '#/infra/logger/appLogger';
import { type DocId } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';
// Cross the CrdtDocument boundary via individual use-case files rather than
// the package barrel. The barrel also re-exports `projectProjection`, which
// transitively imports stores that themselves call `createAutomergeStorage()`
// at module scope. Going through the barrel forms a temporal cycle where this
// function is still `undefined` when those store modules evaluate.
//
// These deep paths match the pre-existing `semanticChangeContext` import style
// in this file and stay within the `useCases/` area (not the private
// `repositories/` path the previous revision of this file reached into).
import { getCrdtDoc } from '#/modules/CrdtDocument/useCases/getCrdtDoc';
import { hasCrdtDoc } from '#/modules/CrdtDocument/useCases/hasCrdtDoc';
import { mutateCrdtDoc } from '#/modules/CrdtDocument/useCases/mutateCrdtDoc';
import { getSemanticContext } from '#/modules/CrdtDocument/useCases/semanticChangeContext';

import { type StorageAdapter } from './types';

type AutomergeStorageOptions<TData> = {
    /** Optional function to strip ephemeral fields before writing to CRDT. */
    toCrdt?: (value: TData) => Partial<TData>;
    /** Optional function to normalize incoming data on hydrate (e.g. fill missing fields from older schemas). */
    fromCrdt?: (value: TData) => TData;
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
    const fromCrdt = options?.fromCrdt;
    let cachedValue: TData | null = null;
    let rafId: number | null = null;
    /**
     * §119.2 — Cached canonical JSON of the last hydrate. Lets hydrate()
     * skip re-stringifying cachedValue on every sync message when the
     * incoming doc slot hasn't changed (hot path during multi-peer
     * collaboration).
     */
    let lastHydratedJson: string | null = null;

    const toDocSafe = <TValue>(value: TValue): TValue => JSON.parse(JSON.stringify(value)) as TValue;

    const writeToCrdt = (value: TData | null): void => {
        if (!hasCrdtDoc(docId)) {
            return;
        }

        const crdtValue = value !== null && toCrdt ? toCrdt(value) : value;
        const semanticCtx = getSemanticContext();
        const message = semanticCtx?.message;

        mutateCrdtDoc<Record<string, unknown>>({
            id: docId,
            changeFn: (doc) => {
                if (crdtValue === null) {
                    delete doc[key];
                } else {
                    doc[key] = toDocSafe(crdtValue);
                }
            },
            message,
        });
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
                        logger.warn('[AutomergeStorage] CRDT write failed, in-memory state still updated:', error);
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
            const doc = getCrdtDoc<Record<string, unknown>>(docId);
            if (!doc) {
                return false;
            }

            const value = (doc as Record<string, unknown>)[key];
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
