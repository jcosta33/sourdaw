import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import {
    runInProjectAudioStorageLock,
    type ProjectAudioStorageLockScope,
    withProjectAudioStorageLock,
} from '../withProjectAudioStorageLock';

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let settle!: () => void;
    const promise = new Promise<void>((resolve) => {
        settle = resolve;
    });
    return { promise, resolve: settle };
}

describe('withProjectAudioStorageLock', () => {
    beforeEach(() => {
        Container.clear();
    });

    afterEach(() => {
        Container.clear();
    });

    it('serializes callbacks under one fixed exclusive name until each awaited operation settles', async () => {
        const manager = createControlledLockManager();
        injectDependencies(withProjectAudioStorageLock, { resolveLockManager: () => manager.locks });
        const held = deferred();
        const events: string[] = [];
        const first = withProjectAudioStorageLock(async () => {
            events.push('first:start');
            await held.promise;
            events.push('first:end');
        });
        const second = withProjectAudioStorageLock(async () => {
            events.push('second');
        });

        await vi.waitFor(() => expect(events).toEqual(['first:start']));
        held.resolve();
        await Promise.all([first, second]);

        expect(events).toEqual(['first:start', 'first:end', 'second']);
        expect(manager.requestedNames).toEqual(['sourdaw:project-audio-storage', 'sourdaw:project-audio-storage']);
    });

    it('fails closed when Web Locks are unavailable', async () => {
        injectDependencies(withProjectAudioStorageLock, { resolveLockManager: () => undefined });

        await expect(withProjectAudioStorageLock(async () => undefined)).rejects.toThrow('Web Locks API');
    });

    it('keeps the outer lock held until unawaited nested work settles without reacquiring', async () => {
        const manager = createControlledLockManager();
        injectDependencies(withProjectAudioStorageLock, { resolveLockManager: () => manager.locks });
        const nested = deferred();
        const events: string[] = [];

        const first = withProjectAudioStorageLock(async (scope) => {
            void runInProjectAudioStorageLock(scope, async () => {
                events.push('nested:start');
                await nested.promise;
                events.push('nested:end');
            });
        });
        const second = withProjectAudioStorageLock(async () => {
            events.push('second');
        });

        await vi.waitFor(() => expect(events).toEqual(['nested:start']));
        expect(manager.requestedNames).toEqual(['sourdaw:project-audio-storage', 'sourdaw:project-audio-storage']);
        nested.resolve();
        await Promise.all([first, second]);

        expect(events).toEqual(['nested:start', 'nested:end', 'second']);
    });

    it('closes the scope before a later callback can add work after the final drain', async () => {
        const manager = createControlledLockManager();
        injectDependencies(withProjectAudioStorageLock, { resolveLockManager: () => manager.locks });
        const nested = deferred();
        const events: string[] = [];
        let lateResult: Promise<'accepted' | 'rejected'> | undefined;

        const first = withProjectAudioStorageLock(async (scope) => {
            queueMicrotask(() => {
                queueMicrotask(() => {
                    queueMicrotask(() => {
                        lateResult = runInProjectAudioStorageLock(scope, async () => {
                            events.push('late:start');
                            await nested.promise;
                            events.push('late:end');
                        }).then(
                            () => 'accepted',
                            (error: unknown) => {
                                expect(error).toEqual(
                                    new Error('Project audio storage lock scope is invalid or expired')
                                );
                                return 'rejected';
                            }
                        );
                    });
                });
            });
        });
        const second = withProjectAudioStorageLock(async () => {
            events.push('second');
        });

        await vi.waitFor(() => expect(lateResult).toBeDefined());
        await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
        if (events[0] === 'second') {
            await expect(lateResult).resolves.toBe('rejected');
            expect(events).toEqual(['second']);
            nested.resolve();
            await Promise.all([first, second]);
            return;
        }

        expect(events).toEqual(['late:start']);
        nested.resolve();
        await expect(lateResult).resolves.toBe('accepted');
        await Promise.all([first, second]);
        expect(events).toEqual(['late:start', 'late:end', 'second']);
    });

    it('keeps the lock through nested settlement when the outer callback rejects', async () => {
        const manager = createControlledLockManager();
        injectDependencies(withProjectAudioStorageLock, { resolveLockManager: () => manager.locks });
        const nested = deferred();
        const events: string[] = [];

        const first = withProjectAudioStorageLock(async (scope) => {
            void runInProjectAudioStorageLock(scope, async () => {
                events.push('nested:start');
                await nested.promise;
                events.push('nested:end');
            });
            throw new Error('outer failed');
        });
        void first.catch(() => undefined);
        const second = withProjectAudioStorageLock(async () => {
            events.push('second');
        });

        await vi.waitFor(() => expect(events).toEqual(['nested:start']));
        nested.resolve();
        await expect(first).rejects.toThrow('outer failed');
        await second;
        expect(events).toEqual(['nested:start', 'nested:end', 'second']);
    });

    it('rejects forged and expired nested scopes', async () => {
        const manager = createControlledLockManager();
        injectDependencies(withProjectAudioStorageLock, { resolveLockManager: () => manager.locks });
        const forged = {} as ProjectAudioStorageLockScope;

        await expect(runInProjectAudioStorageLock(forged, async () => undefined)).rejects.toThrow('invalid or expired');

        let expired!: ProjectAudioStorageLockScope;
        await withProjectAudioStorageLock(async (scope) => {
            expired = scope;
            await runInProjectAudioStorageLock(scope, async () => undefined);
        });
        await expect(runInProjectAudioStorageLock(expired, async () => undefined)).rejects.toThrow(
            'invalid or expired'
        );
        expect(manager.requestedNames).toEqual(['sourdaw:project-audio-storage']);
    });

    it('propagates lock-manager and callback rejection', async () => {
        injectDependencies(withProjectAudioStorageLock, {
            resolveLockManager: () => ({ request: () => Promise.reject(new Error('lock rejected')) }),
        });
        await expect(withProjectAudioStorageLock(async () => undefined)).rejects.toThrow('lock rejected');

        Container.clear();
        injectDependencies(withProjectAudioStorageLock, {
            resolveLockManager: () => createControlledLockManager().locks,
        });
        await expect(
            withProjectAudioStorageLock(async () => {
                throw new Error('callback failed');
            })
        ).rejects.toThrow('callback failed');
    });
});
