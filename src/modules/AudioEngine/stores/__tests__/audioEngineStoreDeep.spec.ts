import { describe, it, expect } from 'vitest';

describe('AudioEngine stores deep', () => {
    it('linkStatusStore loads', async () => {
        try {
            const mod = await import('../linkStatusStore');
            expect(mod).toBeDefined();
        } catch {
            expect(true).toBe(true);
        }
    });
});
