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

    // AC-4. The defect: the localStorage mirror froze at the moment the project
    // first exceeded quota, while IndexedDB kept receiving every later save.
    // Mutation: restoring `if (local !== null) { return local; }` at the top of
    // readNamedProjectJson reds this — it resolves to the stale mirror.
    it('resolves the fresh IndexedDB copy over a stale localStorage mirror', async () => {
        const controls = installFakeIndexedDb();
        const stale = snapshot('Frozen', 1700000000000);
        const fresh = snapshot('Current', 1800000000000);
        localStorage.setItem(KEY, stale);
        controls.values.set(KEY, fresh);
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(KEY)).resolves.toBe(fresh);
    });

    // AC-4. Recency, not store rank: an unmigrated mirror that is genuinely
    // newer than the primary still wins. Mutation: hardcoding "IndexedDB always
    // wins when present" reds this.
    it('resolves the localStorage mirror when it is newer than the IndexedDB copy', async () => {
        const controls = installFakeIndexedDb();
        const newerMirror = snapshot('Mirror', 1800000000000);
        const olderPrimary = snapshot('Primary', 1700000000000);
        localStorage.setItem(KEY, newerMirror);
        controls.values.set(KEY, olderPrimary);
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(KEY)).resolves.toBe(newerMirror);
    });

    it('resolves the localStorage mirror when IndexedDB has no copy', async () => {
        installFakeIndexedDb();
        const mirror = snapshot('OnlyCopy', 1700000000000);
        localStorage.setItem(KEY, mirror);
        const { readNamedProjectJson } = await import('../readNamedProjectJson');

        await expect(readNamedProjectJson(KEY)).resolves.toBe(mirror);
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
