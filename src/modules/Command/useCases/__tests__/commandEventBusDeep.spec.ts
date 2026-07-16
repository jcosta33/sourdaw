import { describe, it, expect } from 'vitest';

describe('CommandEventBus', () => {
    it('is a class', () => {
        const mod = await import('../commandEventBus');
        expect(mod.CommandEventBus).toBeDefined();
    });
});
