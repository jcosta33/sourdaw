import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('writeProjectJson', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.resetModules();
    });

    it('updates the synchronous cache and localStorage fallback', async () => {
        const { writeProjectJson } = await import('../writeProjectJson');
        const { readProjectJson } = await import('../readProjectJson');
        const json = JSON.stringify({ name: 'Test' });

        writeProjectJson(json);

        expect(readProjectJson()).toBe(json);
        expect(localStorage.getItem('sourdaw-project')).toBe(json);
    });
});
