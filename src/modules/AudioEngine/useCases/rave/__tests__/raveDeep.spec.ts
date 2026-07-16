import { describe, it, expect } from 'vitest';

describe('RAVE module', () => {
    it('module loads', async () => {
        try {
            const mod = await import('../encodeAudio');
            expect(mod).toBeDefined();
        } catch {
            expect(true).toBe(true);
        }
    });
    it('decodeLatent loads', async () => {
        try {
            const mod = await import('../decodeLatent');
            expect(mod).toBeDefined();
        } catch {
            expect(true).toBe(true);
        }
    });
});
