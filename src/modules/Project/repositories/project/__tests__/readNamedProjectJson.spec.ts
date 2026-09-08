import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../__tests__/fakeIndexedDb';

const KEY = 'sourdaw:project:1700000000000';

function snapshot(name: string, updatedAt: number): string {
    return JSON.stringify({ version: 1, meta: { name, createdAt: 1700000000000, updatedAt } });
}

describe('readNamedProjectJson', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('reads the IndexedDB copy without consulting a stale localStorage record', async () => {
        const controls = installFakeIndexedDb();
        const stale = snapshot('Frozen', 1700000000000);
        const fresh = snapshot('Current', 1800000000000);
        localStorage.setItem(KEY, stale);
        controls.values.set(KEY, fresh);
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(KEY)).resolves.toBe(fresh);
    });

    it('reads the IndexedDB copy even when localStorage contains newer legacy content', async () => {
        const controls = installFakeIndexedDb();
        const newerMirror = snapshot('Mirror', 1800000000000);
        const olderPrimary = snapshot('Primary', 1700000000000);
        localStorage.setItem(KEY, newerMirror);
        controls.values.set(KEY, olderPrimary);
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(KEY)).resolves.toBe(olderPrimary);
    });

    it('returns null when only legacy localStorage contains the key', async () => {
        installFakeIndexedDb();
        const mirror = snapshot('OnlyCopy', 1700000000000);
        localStorage.setItem(KEY, mirror);
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(KEY)).resolves.toBeNull();
    });

    it('resolves the IndexedDB copy when localStorage has no mirror', async () => {
        const controls = installFakeIndexedDb();
        const primary = snapshot('Large', 1700000000000);
        controls.values.set(KEY, primary);
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(KEY)).resolves.toBe(primary);
    });

    it('resolves null when neither store holds the key', async () => {
        installFakeIndexedDb();
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(KEY)).resolves.toBeNull();
    });
});
