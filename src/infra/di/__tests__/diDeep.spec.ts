import { describe, it, expect } from 'vitest';

describe('DI Container', () => {
    it('module loads', async () => {
        const mod = await import('../Container');
        expect(mod).toBeDefined();
    });
});
