import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../__tests__/fakeIndexedDb';

describe('writeProjectJson', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('updates the synchronous cache and commits the document to IndexedDB', async () => {
        const controls = installFakeIndexedDb();
        const { writeProjectJson } = await import('../writeProjectJson');
        const { readProjectJson } = await import('../readProjectJson');
        const json = JSON.stringify({ name: 'Test' });

        await writeProjectJson(json);

        expect(readProjectJson()).toBe(json);
        expect(controls.values.get('current')).toBe(json);
    });

    // AC-1. Mutation: restoring `window.localStorage.setItem(legacyKey, json)`
    // reds `expect(localStorage.getItem('sourdaw-project')).toBeNull()`.
    it('writes no project content to localStorage', async () => {
        installFakeIndexedDb();
        const { writeProjectJson } = await import('../writeProjectJson');

        await writeProjectJson(JSON.stringify({ name: 'Test' }));

        expect(localStorage.getItem('sourdaw-project')).toBeNull();
        expect(localStorage.length).toBe(0);
    });

    // AC-2. Mutation: resolving on `request.onsuccess` reds this.
    it('rejects when the transaction aborts', async () => {
        const controls = installFakeIndexedDb();
        controls.abortWrites();
        const { writeProjectJson } = await import('../writeProjectJson');

        await expect(writeProjectJson('{}')).rejects.toThrow(/abort/i);
    });
});
