import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { withDdspInstrumentLock } from '../withDdspInstrumentLock';

type PendingLock = { mode: LockMode; start: (finish: () => void) => void };

function createLockManager(): { locks: Pick<LockManager, 'request'>; names: string[] } {
    const queues = new Map<string, PendingLock[]>();
    const active = new Map<string, { exclusive: boolean; shared: number }>();
    const names: string[] = [];
    const drain = (name: string): void => {
        const queue = queues.get(name) ?? [];
        const lock = active.get(name) ?? { exclusive: false, shared: 0 };
        if (lock.exclusive || queue.length === 0) {
            return;
        }
        if (queue[0]?.mode === 'exclusive') {
            if (lock.shared > 0) {
                return;
            }
            const next = queue.shift();
            if (next === undefined) {
                return;
            }
            lock.exclusive = true;
            active.set(name, lock);
            next.start(() => {
                lock.exclusive = false;
                drain(name);
            });
            return;
        }
        while (queue[0]?.mode === 'shared') {
            const next = queue.shift();
            if (next === undefined) {
                return;
            }
            lock.shared += 1;
            active.set(name, lock);
            next.start(() => {
                lock.shared -= 1;
                drain(name);
            });
        }
    };

    class FakeLockManager implements Pick<LockManager, 'request'> {
        request<T>(name: string, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
        request<T>(name: string, options: LockOptions, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
        request<T>(
            name: string,
            optionsOrCallback: LockOptions | LockGrantedCallback<T>,
            suppliedCallback?: LockGrantedCallback<T>
        ): Promise<Awaited<T>> {
            const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
            const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : suppliedCallback;
            if (callback === undefined) {
                return Promise.reject(new TypeError('Lock callback is required'));
            }
            return new Promise((resolve, reject) => {
                names.push(name);
                const queue = queues.get(name) ?? [];
                queues.set(name, queue);
                queue.push({
                    mode: options.mode ?? 'exclusive',
                    start: (finish) => {
                        void Promise.resolve(callback(null)).then(resolve, reject).finally(finish);
                    },
                });
                drain(name);
            });
        }
    }

    return { locks: new FakeLockManager(), names };
}

function gate(): { open: () => void; promise: Promise<void> } {
    let open = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { open, promise };
}

describe('withDdspInstrumentLock', () => {
    beforeEach(() => {
        injectDependencies(withDdspInstrumentLock, { locks: createLockManager().locks });
    });

    it('allows concurrent readers but queues download and removal until every reader releases', async () => {
        const first = gate();
        const second = gate();
        const events: string[] = [];
        const readerA = withDdspInstrumentLock('ddsp-violin', 'shared', async () => {
            events.push('reader-a-start');
            await first.promise;
            events.push('reader-a-end');
        });
        const readerB = withDdspInstrumentLock('ddsp-violin', 'shared', async () => {
            events.push('reader-b-start');
            await second.promise;
            events.push('reader-b-end');
        });
        const removal = withDdspInstrumentLock('ddsp-violin', 'exclusive', async () => {
            events.push('remove');
        });
        const download = withDdspInstrumentLock('ddsp-violin', 'exclusive', async () => {
            events.push('download');
        });

        await vi.waitFor(() => expect(events).toEqual(['reader-a-start', 'reader-b-start']));
        first.open();
        await readerA;
        expect(events).not.toContain('remove');
        second.open();
        await Promise.all([readerB, removal, download]);

        expect(events).toEqual([
            'reader-a-start',
            'reader-b-start',
            'reader-a-end',
            'reader-b-end',
            'remove',
            'download',
        ]);
    });

    it('fails closed when Chromium Web Locks are unavailable', async () => {
        injectDependencies(withDdspInstrumentLock, { locks: undefined });

        await expect(withDdspInstrumentLock('ddsp-violin', 'shared', async () => undefined)).rejects.toThrow(
            'Web Locks API'
        );
    });

    it('uses a distinct exact lock name for each instrument so unrelated work is independent', async () => {
        const manager = createLockManager();
        injectDependencies(withDdspInstrumentLock, { locks: manager.locks });
        const blocked = gate();
        const events: string[] = [];
        const violin = withDdspInstrumentLock('ddsp-violin', 'exclusive', async () => {
            events.push('violin-start');
            await blocked.promise;
            events.push('violin-end');
        });
        const flute = withDdspInstrumentLock('ddsp-flute', 'exclusive', async () => {
            events.push('flute');
        });

        await vi.waitFor(() => expect(events).toEqual(['violin-start', 'flute']));
        expect(manager.names).toEqual(['sourdaw:ddsp:ddsp-violin', 'sourdaw:ddsp:ddsp-flute']);
        blocked.open();
        await Promise.all([violin, flute]);
    });
});
