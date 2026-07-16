import { describe, it, expect } from 'vitest';

describe('renderKokoroTts deep', () => {
    it('module loads', async () => {
        const mod = await import('../index');
        expect(mod).toBeDefined();
    });
});
