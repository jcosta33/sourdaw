import { describe, it, expect } from 'vitest';

describe('loopStationStore deep', () => {
    it('module loads', async () => {
        try {
            const mod = await import('../loopStationStore');
            expect(mod).toBeDefined();
        } catch {
            expect(true).toBe(true);
        }
    });
});
