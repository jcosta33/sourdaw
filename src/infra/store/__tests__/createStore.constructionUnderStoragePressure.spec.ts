import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { createStore } from '../createStore';
import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '../storage/createAutomergeStorage';
import { createLocalStorage } from '../storage/createLocalStorage';
import { type StorageAdapter } from '../storage/types';

/**
 * A store declared at module scope runs its constructor during ES module
 * evaluation, and the constructor writes: it seeds an empty backing store, and
 * it repairs one holding content this build sanitized. Before #1557 a refused
 * `localStorage` write threw from there, which aborts the module graph — no app
 * code has run yet, so nothing can catch it and the app does not boot.
 *
 * These specs assert construction survives, and that the store is still usable
 * and still sanitized afterwards. Asserting only "did not throw" would go green
 * on a store that silently exposes unsanitized data.
 */
type Counter = { count: number };

function blockEveryDurableWrite(): void {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
}

describe('createStore construction when the backing store refuses writes', () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn(() => undefined)
        );
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it('seeds an empty backing store in memory instead of throwing out of the constructor', () => {
        blockEveryDurableWrite();

        const store = createStore<Counter>({
            storage: createLocalStorage<Counter>('sourdaw-preferences'),
            initialData: { count: 7 },
        });

        expect(store.value).toEqual({ count: 7 });
        expect(window.localStorage.getItem('sourdaw-preferences')).toBeNull();
    });

    it('still exposes the sanitized value when the sanitize write-back is refused', () => {
        window.localStorage.setItem('sourdaw-preferences', stringify({ count: -1 }));
        blockEveryDurableWrite();

        const store = createStore<Counter>({
            storage: createLocalStorage<Counter>('sourdaw-preferences'),
            initialData: { count: 0 },
            sanitize: (value: unknown): Counter => {
                if (typeof value !== 'object' || value === null || !('count' in value)) {
                    return { count: 0 };
                }
                const { count } = value;
                if (typeof count !== 'number' || count < 0) {
                    return { count: 0 };
                }
                return { count };
            },
        });

        // The durable value is still the rejected one — nothing could be written
        // — but readers must not be handed content the sanitizer refused.
        expect(store.value).toEqual({ count: 0 });
        expect(window.localStorage.getItem('sourdaw-preferences')).toBe(stringify({ count: -1 }));
    });

    it('reports through trySet whether a write is durable and notifies subscribers either way', () => {
        const store = createStore<Counter>({
            storage: createLocalStorage<Counter>('sourdaw-preferences'),
            initialData: { count: 1 },
        });
        const seen: (Counter | null)[] = [];
        store.subscribe((value) => {
            seen.push(value);
        });

        expect(store.trySet({ count: 2 })).toBe(true);

        blockEveryDurableWrite();

        expect(store.trySet({ count: 3 })).toBe(false);
        expect(seen).toEqual([{ count: 2 }, { count: 3 }]);
        expect(store.value).toEqual({ count: 3 });
    });

    /**
     * The boolean means durable, and only an adapter that implements `trySet`
     * has claimed it can answer. This used to read a returning `set` as success
     * and report `true` for every adapter that had not opted in — including the
     * 20 Automerge-backed stores, whose `set` records a pending write that
     * `preparePendingWrite` can later abandon.
     */
    describe('adapters that made no durability claim', () => {
        it('reports false for an adapter whose set returns without persisting anything', () => {
            const written: (Counter | null)[] = [];
            const silentAdapter: StorageAdapter<Counter> = {
                get: () => null,
                set: (value: Counter | null) => {
                    written.push(value);
                },
                clear: () => {},
                isSupported: () => true,
            };

            const store = createStore<Counter>({ storage: silentAdapter });

            // The write happened — the claim it is durable did not.
            expect(store.trySet({ count: 5 })).toBe(false);
            expect(written).toContainEqual({ count: 5 });
        });

        it('reports false for an Automerge-backed store, whose write is only queued', () => {
            const doc: { [key: string]: unknown } = {};
            configureAutomergeStoragePort({
                getDoc: () => doc,
                getDocHeads: () => ['head-0'],
                getSemanticMessage: () => undefined,
                hasDoc: () => true,
                mutateDoc: ({ changeFn }) => {
                    changeFn(doc);
                },
            });

            const store = createStore<Counter>({
                storage: createAutomergeStorage<Counter>('root', 'counter', {
                    hydrateMissing: () => ({ count: 1 }),
                }),
            });

            const reported = store.trySet({ count: 99 });

            // Nothing has reached the document at the moment of the call, and
            // `preparePendingWrite` may abandon it before anything does.
            expect(reported).toBe(false);
            expect(doc.counter).toBeUndefined();
        });

        it('still reports true for an adapter that does implement trySet', () => {
            // The positive control. Without it the two assertions above would
            // pass on a store that reports `false` unconditionally.
            const store = createStore<Counter>({
                storage: createLocalStorage<Counter>('sourdaw-preferences'),
            });

            expect(store.trySet({ count: 5 })).toBe(true);
        });
    });

    it('falls back to a guarded set for an adapter that does not implement trySet', () => {
        // Reported through the module logger, not `options.logger`. No
        // production call site passes a logger, so a report gated on one would
        // be a report that never fires where the fallback actually runs — and a
        // test proving it through an injected logger would be proving a
        // configuration that does not ship.
        const error = vi.spyOn(logger, 'error').mockImplementation(() => {});
        const failure = new Error('adapter refused');
        const bareAdapter: StorageAdapter<Counter> = {
            get: () => null,
            set: () => {
                throw failure;
            },
            clear: () => {},
            isSupported: () => true,
        };

        const store = createStore<Counter>({ storage: bareAdapter });

        expect(store.trySet({ count: 5 })).toBe(false);
        expect(error.mock.calls.map((call) => call[0].message)).toEqual(['Store write to backing storage failed']);
        expect(error.mock.calls[0]?.[0]?.cause).toBe(failure);
    });
});
