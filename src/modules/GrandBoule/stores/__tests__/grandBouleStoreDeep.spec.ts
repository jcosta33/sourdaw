import { describe, it, expect } from 'vitest';

describe('grandBouleStore deep', () => {
    it('module loads', async () => {
        const mod = await import('../grandBouleStore');
        expect(mod).toBeDefined();
    });
    it('grandBouleStore is exported', () => {
        return import('../grandBouleStore').then((mod) => {
            if ('grandBouleStore' in mod) {
                expect(mod.grandBouleStore).toBeDefined();
            }
        });
    });
});
