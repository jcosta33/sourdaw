import { describe, expect, it } from 'vitest';

import { createControlledLockManager } from '../createControlledLockManager';

async function settledWithin(promise: Promise<void>): Promise<boolean> {
    let settled = false;
    void promise.then(() => {
        settled = true;
        return settled;
    });
    // A granted request settles through a few promise hops; a macrotask lets all of them run.
    await new Promise((resolve) => setImmediate(resolve));
    return settled;
}

async function requestAndRelease(manager: ReturnType<typeof createControlledLockManager>, name: string) {
    await manager.locks.request(name, () => undefined);
}

describe('createControlledLockManager nextRequest', () => {
    it('keeps a named wait pending for requests under other names and resolves it on its own name', async () => {
        const manager = createControlledLockManager();
        const wait = manager.nextRequest('wanted');

        await requestAndRelease(manager, 'other');
        expect(await settledWithin(wait)).toBe(false);

        await requestAndRelease(manager, 'wanted');
        expect(await settledWithin(wait)).toBe(true);
    });

    it('resolves an unnamed wait on a request under any name', async () => {
        const manager = createControlledLockManager();
        const wait = manager.nextRequest();

        await requestAndRelease(manager, 'anything');

        expect(await settledWithin(wait)).toBe(true);
    });

    it('does not resolve a wait for a request made before the wait was created', async () => {
        const manager = createControlledLockManager();
        await requestAndRelease(manager, 'wanted');

        const wait = manager.nextRequest('wanted');

        expect(await settledWithin(wait)).toBe(false);
    });

    it('resolves every wait that matches one request and leaves the others pending', async () => {
        const manager = createControlledLockManager();
        const named = manager.nextRequest('wanted');
        const unnamed = manager.nextRequest();
        const other = manager.nextRequest('other');

        await requestAndRelease(manager, 'wanted');

        expect([await settledWithin(named), await settledWithin(unnamed), await settledWithin(other)]).toEqual([
            true,
            true,
            false,
        ]);
    });
});
