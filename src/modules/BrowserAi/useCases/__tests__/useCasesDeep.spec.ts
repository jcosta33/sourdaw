import { describe, it, expect } from 'vitest';

describe('renderKokoroTts deep', () => {
    it('detectCapabilities loads', async () => {
        const mod = await import('../detectCapabilities');
        expect(mod).toBeDefined();
    });
    it('downloadModel loads', async () => {
        const mod = await import('../downloadModel');
        expect(mod).toBeDefined();
    });
    it('removeModel loads', async () => {
        const mod = await import('../removeModel');
        expect(mod).toBeDefined();
    });
    it('renderKokoroTts loads', async () => {
        const mod = await import('../renderKokoroTts');
        expect(mod).toBeDefined();
    });
});
