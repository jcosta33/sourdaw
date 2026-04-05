/* (c) Copyright Sourdaw Ltd., all rights reserved. */

import { type DocId } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';
import { automergeRepository } from '#/modules/CrdtDocument/repositories/automergeRepository';
import { getSemanticContext } from '#/modules/CrdtDocument/useCases/semanticChangeContext';

import { type Storage } from './Storage';

type AutomergeStorageOptions<TDataSchema> = {
    /** Optional function to strip ephemeral fields before writing to CRDT. */
    toCrdt?: (value: TDataSchema) => Partial<TDataSchema>;
};

/**
 * A Storage backend that persists store state in an Automerge CRDT document.
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
 * `set()` updates the in-memory cache and notifies React subscribers
 * immediately (so the UI stays responsive at any frame rate). The actual
 * Automerge `changeDoc()` write is deferred to the next animation frame via
 * `requestAnimationFrame`.  This collapses rapid burst updates (knob sweeps,
 * fader drags, clip moves) into a single CRDT mutation per frame instead of
 * hundreds, eliminating the JSON-serialisation + CRDT-merge cost on the hot
 * path.
 *
 * ## Automerge v3 constraints handled here
 *
 * Values read from an Automerge doc are Proxy objects. Automerge rejects
 * re-inserting a proxy into a `change()` call ("Cannot create a reference
 * to an existing document object"). It also rejects `undefined` values
 * ("Cannot assign undefined value").
 *
 * `#toDocSafe()` strips both via a JSON round-trip — the only serialisation
 * format guaranteed to produce a plain object with no undefined properties.
 * All store values are JSON-serialisable so there is no type loss.
 */
export class AutomergeStorage<TDataSchema> implements Storage<TDataSchema> {
    readonly #docId: DocId;
    readonly #key: string;
    readonly #toCrdt: ((value: TDataSchema) => Partial<TDataSchema>) | undefined;
    #cachedValue: TDataSchema | null = null;
    /** rAF handle for the deferred CRDT write, or null when idle. */
    #rafId: number | null = null;

    /**
     * @param docId - The Automerge document ID (typically the root doc).
     * @param key - The key within the document to store this state under.
     * @param options - Optional configuration.
     */
    constructor(docId: DocId, key: string, options?: AutomergeStorageOptions<TDataSchema>) {
        this.#docId = docId;
        this.#key = key;
        this.#toCrdt = options?.toCrdt;
    }

    get(): TDataSchema | null {
        return this.#cachedValue;
    }

    set(value: TDataSchema | null): void {
        // Always update the in-memory cache first — this is the UI source of
        // truth and must be synchronous so React's useSyncExternalStore sees
        // the new value on the very next render cycle.
        this.#cachedValue = value;

        // Batch the actual CRDT write to the next animation frame so that
        // burst updates (e.g. 120 fader-drag events within one frame) result
        // in a single Automerge changeDoc() call instead of 120.
        if (this.#rafId === null) {
            this.#rafId = requestAnimationFrame(() => {
                this.#rafId = null;
                try {
                    this.#writeToCrdt(this.#cachedValue);
                } catch (error) {
                    console.error('[AutomergeStorage] CRDT write failed, in-memory state still updated:', error);
                }
            });
        }
    }

    clear(): void {
        this.set(null);
    }

    isSupported(): boolean {
        return true;
    }

    /**
     * Hydrate the in-memory cache from the Automerge document.
     *
     * If the key exists in the doc, the cache is populated from it.
     * If the key does NOT exist but the cache has a value (from initialData),
     * the cached value is written to the doc so it persists.
     */
    hydrate(): boolean {
        const doc = automergeRepository.getDoc(this.#docId);
        if (!doc) {
            return false;
        }

        const value = (doc as Record<string, unknown>)[this.#key];
        if (value !== undefined) {
            // Compute the JSON string once so we can both parse it and use it
            // for change-detection without a second full stringify on the hot path.
            const incomingJson = JSON.stringify(value);
            const crdtData = JSON.parse(incomingJson) as TDataSchema;
            const beforeJson = JSON.stringify(this.#cachedValue);

            if (this.#toCrdt && this.#cachedValue !== null && typeof crdtData === 'object' && crdtData !== null) {
                // Store has ephemeral fields (toCrdt strips them on write).
                // Merge CRDT data into the existing cache to preserve ephemeral fields
                // like selectedTrackId, isPlaying, playheadPosition.
                this.#cachedValue = { ...this.#cachedValue, ...crdtData };
                return JSON.stringify(this.#cachedValue) !== beforeJson;
            } else {
                this.#cachedValue = crdtData;
                // Re-use the already-computed incoming JSON — avoids re-stringifying
                // the just-assigned cache on the common non-merge path.
                return incomingJson !== beforeJson;
            }
        }

        if (this.#cachedValue !== null) {
            // Key missing from doc but cache has initialData — write it through.
            this.#writeToCrdt(this.#cachedValue);
        }

        return false;
    }

    #writeToCrdt(value: TDataSchema | null): void {
        if (!automergeRepository.hasDoc(this.#docId)) {
            return;
        }

        const crdtValue = value !== null && this.#toCrdt ? this.#toCrdt(value) : value;
        const semanticCtx = getSemanticContext();
        const message = semanticCtx?.message;

        automergeRepository.changeDoc(
            this.#docId,
            (doc: Record<string, unknown>) => {
                if (crdtValue === null) {
                    delete doc[this.#key];
                } else {
                    doc[this.#key] = this.#toDocSafe(crdtValue);
                }
            },
            message
        );
    }

    /**
     * Produce a plain, Automerge-safe copy of a value.
     *
     * A JSON round-trip ensures:
     * - Automerge Proxy objects are stripped (re-inserting a proxy throws).
     * - `undefined` properties are dropped (assigning undefined throws).
     */
    #toDocSafe<T>(value: T): T {
        return JSON.parse(JSON.stringify(value));
    }
}
