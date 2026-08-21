import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { withDdspInstrumentLock } from '../withDdspInstrumentLock';

type PendingLock = {
    mode: LockMode;
    start: (finish: () => void) => void;
};

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
            const next = queue.shift()!;
            activeExclusive = true;
            next.start(() => {
                activeExclusive = false;
                drain();
            });
            return;
        }
        while (queue[0]?.mode === 'shared') {
            const next = queue.shift()!;
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
            if (!callback) {
                return Promise.reject(new TypeError('Lock callback is required'));
            }
            return new Promise<Awaited<T>>((resolve, reject) => {
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

function gate(): { promise: Promise<void>; open: () => void } {
    let open = (): void => undefined;
    const promise = new Promise<void>((resolve) => {
        open = resolve;
    });
    return { promise, open };
}

describe('withDdspInstrumentLock', () => {
    beforeEach(() => {
        injectDependencies(withDdspInstrumentLock, { locks: createLockManager() });
    });

    it('allows sibling shared renders and queues exclusive removal/download until both release', async () => {
        const first = gate();
        const second = gate();
        const events: string[] = [];

        const renderA = withDdspInstrumentLock('ddsp-violin', 'shared', async () => {
            events.push('render-a-start');
            await first.promise;
            events.push('render-a-end');
        });
        const renderB = withDdspInstrumentLock('ddsp-violin', 'shared', async () => {
            events.push('render-b-start');
            await second.promise;
            events.push('render-b-end');
        });
        const removal = withDdspInstrumentLock('ddsp-violin', 'exclusive', async () => {
            events.push('remove');
        });
        const download = withDdspInstrumentLock('ddsp-violin', 'exclusive', async () => {
            events.push('download');
        });

        await vi.waitFor(() => expect(events).toEqual(['render-a-start', 'render-b-start']));
        first.open();
        await renderA;
        expect(events).not.toContain('remove');
        second.open();
        await Promise.all([renderB, removal, download]);

        expect(events).toEqual([
            'render-a-start',
            'render-b-start',
            'render-a-end',
            'render-b-end',
            'remove',
            'download',
        ]);
    });
});
