import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('removeProjectJson', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.resetModules();
    });

    it('clears the synchronous cache and localStorage fallback', async () => {
        const { writeProjectJson } = await import('../writeProjectJson');
        const { removeProjectJson } = await import('../removeProjectJson');
        const { readProjectJson } = await import('../readProjectJson');
        writeProjectJson('{}');

        removeProjectJson();

        expect(readProjectJson()).toBeNull();
        expect(localStorage.getItem('sourdaw-project')).toBeNull();
    });
});
