import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { completeAcceptanceResults, createAcceptanceFixtureLifetime } from './acceptanceFixtureLifetime';

function deferred() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

describe('acceptance fixture lifetime', () => {
    it('holds admission through body and cleanup and preserves body failures', async () => {
        const lifetime = createAcceptanceFixtureLifetime();
        const body = deferred();
        const bodyStarted = deferred();
        const cleanup = deferred();
        const cleanupStarted = deferred();
        const events: string[] = [];
        const failure = new Error('body failure');
        const running = lifetime.track(async () => {
            events.push('body');
            bodyStarted.release();
            await body.promise;
            throw failure;
        });
        const restored = lifetime.cleanup(async () => {
            events.push('cleanup');
            cleanupStarted.release();
            await cleanup.promise;
            events.push('restored');
        });
        const admission = lifetime.drain().then(() => events.push('admitted'));
        try {
            await bodyStarted.promise;
            expect(events).toEqual(['body']);
            body.release();
            await expect(running).rejects.toBe(failure);
            await cleanupStarted.promise;
            expect(events).toEqual(['body', 'cleanup']);
            expect(() => lifetime.track(async () => undefined)).toThrow('still active');
            cleanup.release();
            await restored;
            await admission;
            expect(events).toEqual(['body', 'cleanup', 'restored', 'admitted']);
        } finally {
            body.release();
            cleanup.release();
            await admission;
        }
    });

    it('keeps a failed cleanup closed', async () => {
        const lifetime = createAcceptanceFixtureLifetime();
        const failure = new Error('restore failed');
        await expect(
            lifetime.cleanup(() => {
                throw failure;
            })
        ).rejects.toBe(failure);
        await expect(lifetime.drain()).rejects.toBe(failure);
        expect(() => lifetime.track(async () => undefined)).toThrow('still active');
    });

    it('requires every frozen case before rolling up', () => {
        expect(
            completeAcceptanceResults(
                ['a', 'b'],
                new Map([
                    ['a', 1],
                    ['b', 2],
                ])
            )
        ).toEqual([1, 2]);
        expect(() => completeAcceptanceResults(['a', 'b'], new Map([['a', 1]]))).toThrow(
            'exact frozen case population'
        );
        expect(() =>
            completeAcceptanceResults(
                ['a', 'b'],
                new Map([
                    ['a', 1],
                    ['c', 2],
                ])
            )
        ).toThrow('exact frozen case population');
        expect(() => completeAcceptanceResults(['a', 'a'], new Map([['a', 1]]))).toThrow(
            'exact frozen case population'
        );
    });
});

const blockedLifetime = createAcceptanceFixtureLifetime();
const blocked = deferred();
const trace: string[] = [];
const owner = blockedLifetime.track(async () => {
    await blocked.promise;
});
let setup = false;
const hookReasons: string[] = [];
describe('deadline admission fail closed', () => {
    beforeEach((context) => {
        context.signal.addEventListener(
            'abort',
            () => {
                hookReasons.push(String(context.signal.reason));
            },
            { once: true }
        );
        return blockedLifetime.drain();
    }, 100);
    beforeEach(() => {
        setup = true;
        trace.push('nested setup');
    });
    afterEach(() => {
        if (!setup) {
            trace.push('teardown skipped');
            return;
        }
        setup = false;
        trace.push('teardown ran');
    });
    it.fails('refuses body when admission itself times out', async () => {
        trace.push('body ran');
    });
    it.fails('also refuses the next body while the owner remains held', async () => {
        trace.push('later body ran');
    });
});

describe('deadline admission control', () => {
    it('records the refused body and skipped teardown before releasing the owner', async () => {
        try {
            expect(hookReasons).toHaveLength(2);
            expect(hookReasons.every((reason) => reason.includes('timed out'))).toBe(true);
            expect(trace).toEqual(['teardown skipped', 'teardown skipped']);
        } finally {
            blocked.release();
            await owner;
        }
        await blockedLifetime.drain();
    });
});

describe('late result publication', () => {
    const hold = deferred();
    const published = new Map<string, number>();
    let completion: Promise<void>;
    let reason = '';
    it.fails(
        'times out before the case result exists',
        async (context) => {
            let result: number | undefined;
            context.signal.addEventListener(
                'abort',
                () => {
                    reason = String(context.signal.reason);
                },
                { once: true }
            );
            context.onTestFinished(() => {
                if (context.task.result?.state === 'pass' && !context.signal.aborted && result !== undefined)
                    published.set('case', result);
            });
            completion = (async () => {
                await hold.promise;
                result = 1;
            })();
            await completion;
        },
        100
    );
    it('refuses the timed-out result even after the callback later settles', async () => {
        try {
            expect(reason).toContain('timed out');
            expect(published.size).toBe(0);
        } finally {
            hold.release();
            await completion;
        }
        expect(published.size).toBe(0);
        expect(() => completeAcceptanceResults(['case'], published)).toThrow('exact frozen case population');
    });
});
