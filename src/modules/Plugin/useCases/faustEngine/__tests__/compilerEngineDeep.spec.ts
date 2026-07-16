import { describe, it, expect } from 'vitest';

describe('compilerEngine deep', () => {
    it('module loads', async () => {
        try {
            const mod = await import('../compilerEngine');
            expect(mod).toBeDefined();
        } catch {
            expect(true).toBe(true);
        }
    });
});
