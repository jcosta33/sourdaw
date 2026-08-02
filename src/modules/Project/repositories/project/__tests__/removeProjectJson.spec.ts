import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installFakeIndexedDb } from '../../../__tests__/fakeIndexedDb';

describe('removeProjectJson', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('clears the synchronous cache and the committed IndexedDB document', async () => {
        const controls = installFakeIndexedDb();
        const { writeProjectJson } = await import('../writeProjectJson');
        const { removeProjectJson } = await import('../removeProjectJson');
        const { readProjectJson } = await import('../readProjectJson');
        await writeProjectJson('{}');

        removeProjectJson();

        expect(readProjectJson()).toBeNull();
        await vi.waitFor(() => {
            expect(controls.values.has('current')).toBe(false);
        });
    });

    it('clears the legacy localStorage key written by pre-ADR-0013 builds', async () => {
        installFakeIndexedDb();
        const { removeProjectJson } = await import('../removeProjectJson');
        localStorage.setItem('sourdaw-project', JSON.stringify({ name: 'Legacy' }));

        removeProjectJson();

        expect(localStorage.getItem('sourdaw-project')).toBeNull();
    });
});
