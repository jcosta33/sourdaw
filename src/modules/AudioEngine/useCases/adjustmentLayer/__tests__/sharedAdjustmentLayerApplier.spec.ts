import { describe, it, expect } from 'vitest';

describe('sharedAdjustmentLayerApplier', () => {
    it('module loads', async () => {
        const mod = await import('../sharedAdjustmentLayerApplier');
        expect(mod).toBeDefined();
    });
});
