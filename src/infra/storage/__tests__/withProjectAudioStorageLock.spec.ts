import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createControlledLockManager } from '#/infra/testing/createControlledLockManager';

import { withProjectAudioStorageLock } from '../withProjectAudioStorageLock';

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
