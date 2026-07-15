import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('readProjectJson', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.resetModules();
    });

    it('falls back to legacy localStorage when the cache is empty', async () => {
        const { removeProjectJson } = await import('../removeProjectJson');
        const { readProjectJson } = await import('../readProjectJson');
        const json = JSON.stringify({ name: 'Legacy' });
        removeProjectJson();
        localStorage.setItem('sourdaw-project', json);

        expect(readProjectJson()).toBe(json);
    });
});
