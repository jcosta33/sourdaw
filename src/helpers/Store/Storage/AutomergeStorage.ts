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
        // Always update the cache first — the in-memory value is the UI source
        // of truth. The CRDT write is persistence; it must never crash the caller.
        this.#cachedValue = value;
        try {
            this.#writeToCrdt(value);
        } catch (error) {
            // Log but swallow: Store.set() → Store.#notify() must always run so
            // that useSyncExternalStore subscribers re-render. A throw here would
            // prevent #notify() from being called and silently freeze the UI.
            console.error('[AutomergeStorage] CRDT write failed, in-memory state still updated:', error);
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
            const crdtData = this.#toDocSafe(value) as TDataSchema;
            const beforeJson = JSON.stringify(this.#cachedValue);

            if (this.#toCrdt && this.#cachedValue !== null && typeof crdtData === 'object' && crdtData !== null) {
                // Store has ephemeral fields (toCrdt strips them on write).
                // Merge CRDT data into the existing cache to preserve ephemeral fields
                // like selectedTrackId, isPlaying, playheadPosition.
                this.#cachedValue = { ...this.#cachedValue, ...crdtData };
            } else {
                this.#cachedValue = crdtData;
            }

            return JSON.stringify(this.#cachedValue) !== beforeJson;
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

        automergeRepository.changeDoc(this.#docId, (doc: Record<string, unknown>) => {
            if (crdtValue === null) {
                delete doc[this.#key];
            } else {
                doc[this.#key] = this.#toDocSafe(crdtValue);
            }
        }, message);
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
