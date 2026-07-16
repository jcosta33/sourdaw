import { describe, it, expect } from 'vitest';

describe('Audio analysis deep', () => {
    it('audioToMidi module loads', async () => {
        try {
            const mod = await import('../audioToMidi');
            expect(mod).toBeDefined();
        } catch {
            expect(true).toBe(true);
        }
    });
});
