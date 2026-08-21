import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { withDdspInstrumentLock } from '../withDdspInstrumentLock';

type PendingLock = { mode: LockMode; start: (finish: () => void) => void };

function createLockManager(): Pick<LockManager, 'request'> {
    const queue: PendingLock[] = [];
    let activeExclusive = false;
    let activeShared = 0;
    const drain = (): void => {
        if (activeExclusive || queue.length === 0) {
            return;
        }
        if (queue[0]?.mode === 'exclusive') {
            if (activeShared > 0) {
                return;
            }
            const next = queue.shift();
            if (next === undefined) {
                return;
            }
            activeExclusive = true;
            next.start(() => {
                activeExclusive = false;
                drain();
            });
            return;
        }
        while (queue[0]?.mode === 'shared') {
            const next = queue.shift();
            if (next === undefined) {
                return;
            }
            activeShared += 1;
            next.start(() => {
                activeShared -= 1;
                drain();
            });
        }
    };

    class FakeLockManager implements Pick<LockManager, 'request'> {
        request<T>(name: string, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
        request<T>(name: string, options: LockOptions, callback: LockGrantedCallback<T>): Promise<Awaited<T>>;
        request<T>(
            _name: string,
            optionsOrCallback: LockOptions | LockGrantedCallback<T>,
            suppliedCallback?: LockGrantedCallback<T>
        ): Promise<Awaited<T>> {
            const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
            const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : suppliedCallback;
            if (callback === undefined) {
                return Promise.reject(new TypeError('Lock callback is required'));
            }
            return new Promise((resolve, reject) => {
                queue.push({
                    mode: options.mode ?? 'exclusive',
                    start: (finish) => {
                        void Promise.resolve(callback(null)).then(resolve, reject).finally(finish);
                    },
                });
                drain();
            });
        }
    }

    return new FakeLockManager();
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
        injectDependencies(withDdspInstrumentLock, { locks: createLockManager() });
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
});
