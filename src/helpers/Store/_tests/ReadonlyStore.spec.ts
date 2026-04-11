/* (c) Copyright Frontify Ltd., all rights reserved. */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type Logger } from '../../Logger/Logger';

import { ReadonlyStore } from '../ReadonlyStore';
import { MemoryStorage } from '../Storage/MemoryStorage';
import { type Storage } from '../Storage/Storage';

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('ReadonlyStore', () => {
    let loggerDummy: Logger;
    let storage: Storage<string | null>;

    beforeEach(() => {
        loggerDummy = {
            error: vi.fn(),
        } as unknown as Logger;
        storage = new MemoryStorage<string | null>();
        vi.spyOn(storage, 'get');
        vi.spyOn(storage, 'set');
        vi.spyOn(storage, 'clear');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('create', () => {
        it('should create an instance and call refresh if getDataFn is provided', async () => {
            const mockGetDataFn = vi.fn().mockResolvedValue('created value');
            const store = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage,
                getDataFn: mockGetDataFn,
            });
            expect(store).toBeInstanceOf(ReadonlyStore);
            expect(mockGetDataFn).toHaveBeenCalledTimes(1);
            expect(storage.set).toHaveBeenCalledWith('created value');
            expect(store.value).toBe('created value');
        });

        it('should create an instance without calling refresh if getDataFn is not provided', async () => {
            const store = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage,
                // No getDataFn
            });
            expect(store).toBeInstanceOf(ReadonlyStore);
            expect(storage.set).not.toHaveBeenCalled();
            expect(store.value).toBeNull();
        });

        it('should log an error if initial refresh fails but still create the store instance', async () => {
            const cause = new Error('Initial fetch failed');
            const failingGetDataFn = vi.fn().mockRejectedValue(cause);

            const store = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage,
                getDataFn: failingGetDataFn,
            });

            expect(store).toBeInstanceOf(ReadonlyStore);
            expect(loggerDummy.error).toHaveBeenCalledTimes(1);
            expect(loggerDummy.error).toHaveBeenCalledWith(new Error('Error while refreshing store', { cause }));
            expect(store.value).toBeNull(); // Or initial value of storage
        });
    });

    describe('value', () => {
        it('should return storage value', async () => {
            // For this test, create a store without getDataFn to isolate storage.get
            const store = await ReadonlyStore.create<string | null>(loggerDummy, { storage });
            vi.mocked(storage.get).mockReturnValue('test value');
            expect(store.value).toBe('test value');
            expect(storage.get).toHaveBeenCalled();
        });

        it('should return null when storage is empty', async () => {
            const store = await ReadonlyStore.create<string | null>(loggerDummy, { storage });
            vi.mocked(storage.get).mockReturnValue(null);
            expect(store.value).toBeNull();
        });

        it('should return the initial value when a sync function is provided during creation', async () => {
            const store = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage,
                getDataFn: () => 'sync test value',
            });
            expect(store.value).toBe('sync test value');
        });

        it('should return the initial value when an async function is provided during creation', async () => {
            const store = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage,
                getDataFn: () => Promise.resolve('async test value'),
            });
            expect(store.value).toBe('async test value');
        });
    });

    describe('subscribe', () => {
        let store: ReadonlyStore<string | null>;
        const initialGetDataFn = vi.fn();

        beforeEach(async () => {
            initialGetDataFn.mockReturnValue('initial subscribe value');
            store = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage,
                getDataFn: initialGetDataFn,
            });
            initialGetDataFn.mockClear();
            vi.mocked(storage.set).mockClear();
        });

        it('should add subscriber and notify on refresh, then allow unsubscribe', async () => {
            const callback = vi.fn();
            const unsubscribe = store.subscribe(callback);

            initialGetDataFn.mockReturnValue('refreshed value for subscribe');
            await store.refresh();

            expect(callback).toHaveBeenCalledWith('refreshed value for subscribe');

            unsubscribe();
            initialGetDataFn.mockReturnValue('another value');
            await store.refresh();

            expect(callback).toHaveBeenCalledTimes(1); // Should not be called after unsubscribe
        });

        it('should handle multiple subscribers', async () => {
            const callback1 = vi.fn();
            const callback2 = vi.fn();

            store.subscribe(callback1);
            store.subscribe(callback2);

            initialGetDataFn.mockReturnValue('multi-subscriber value');
            await store.refresh();

            expect(callback1).toHaveBeenCalledWith('multi-subscriber value');
            expect(callback2).toHaveBeenCalledWith('multi-subscriber value');
        });

        it('should handle subscriber errors gracefully and notify other subscribers', async () => {
            const cause = new Error('Subscriber error');

            const workingCallback = vi.fn();
            const throwingCallback = vi.fn(() => {
                throw cause;
            });

            store.subscribe(throwingCallback);
            store.subscribe(workingCallback);

            initialGetDataFn.mockReturnValue('graceful error value');
            await store.refresh();

            expect(throwingCallback).toHaveBeenCalledWith('graceful error value');
            expect(workingCallback).toHaveBeenCalledWith('graceful error value');
            expect(loggerDummy.error).toHaveBeenCalledWith(
                new Error('Error while notifying changes in store', { cause })
            );
        });
    });

    describe('refresh', () => {
        it('should abort previous request when called multiple times', async () => {
            const callback = vi.fn();
            const delayedGetDataFn = vi
                .fn()
                .mockImplementationOnce(async () => {
                    await delay(50);
                    return 'value from create';
                })
                .mockImplementationOnce(async () => {
                    await delay(50);
                    return 'value from R1';
                })
                .mockImplementationOnce(async () => {
                    await delay(10);
                    return 'value from R2';
                });

            const localStore = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage: new MemoryStorage<string | null>(),
                getDataFn: delayedGetDataFn,
            });
            localStore.subscribe(callback);

            expect(delayedGetDataFn).toHaveBeenCalledTimes(1);
            callback.mockClear();

            const promise1 = localStore.refresh();
            const promise2 = localStore.refresh();

            await Promise.allSettled([promise1, promise2]);

            expect(delayedGetDataFn).toHaveBeenCalledTimes(3);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenLastCalledWith('value from R2');
            expect(localStore.value).toBe('value from R2');
        });

        it('should not update store with data from an aborted request', async () => {
            const callback = vi.fn();
            // R0 (create), R1 (aborted), R2 (completes)
            const getDataFn = vi
                .fn()
                .mockImplementationOnce(async () => {
                    await delay(10);
                    return 'initial create value';
                })
                .mockImplementationOnce(async () => {
                    await delay(50);
                    return 'value from aborted R1';
                })
                .mockImplementationOnce(async () => {
                    await delay(10);
                    return 'value from completing R2';
                });

            const localStore = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage: new MemoryStorage<string | null>(),
                getDataFn,
            });
            localStore.subscribe(callback);

            expect(getDataFn).toHaveBeenCalledTimes(1);
            expect(localStore.value).toBe('initial create value');
            callback.mockClear();

            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            localStore.refresh();
            await localStore.refresh();

            expect(getDataFn).toHaveBeenCalledTimes(3);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith('value from completing R2');
            expect(localStore.value).toBe('value from completing R2');
        });

        it('should not log an error from a refresh that was aborted', async () => {
            const throwingGetDataFn = vi
                .fn()
                // For create - make it succeed to isolate test for subsequent refreshes
                .mockImplementationOnce(async () => {
                    await delay(10);
                    return 'create success';
                })
                // For R1 - throws, but should be aborted
                .mockImplementationOnce(async () => {
                    await delay(50);
                    throw new Error('Error from R1');
                })
                // For R2 - succeeds
                .mockImplementationOnce(async () => {
                    await delay(10);
                    return 'value from R2';
                });

            const localStore = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage: new MemoryStorage<string | null>(),
                getDataFn: throwingGetDataFn,
            });

            expect(loggerDummy.error).not.toHaveBeenCalled();

            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            localStore.refresh();
            await localStore.refresh();

            expect(loggerDummy.error).not.toHaveBeenCalled();
            expect(localStore.value).toBe('value from R2');
        });

        it('should log an error from a refresh that fails and is not aborted', async () => {
            const errorToThrow = new Error('Failed refresh');
            const getDataFn = vi.fn().mockResolvedValueOnce('create success').mockRejectedValueOnce(errorToThrow);

            const localStore = await ReadonlyStore.create<string | null>(loggerDummy, {
                storage: new MemoryStorage<string | null>(),
                getDataFn,
            });
            expect(loggerDummy.error).not.toHaveBeenCalled();

            await localStore.refresh();

            expect(loggerDummy.error).toHaveBeenCalledTimes(1);
            expect(loggerDummy.error).toHaveBeenCalledWith(
                new Error('Error while refreshing store', { cause: errorToThrow })
            );
        });
    });
});
