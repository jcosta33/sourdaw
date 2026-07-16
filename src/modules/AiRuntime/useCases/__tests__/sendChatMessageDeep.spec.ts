import { describe, it, expect } from 'vitest';

describe('sendChatMessage deep', () => {
    it('module loads', async () => {
        const mod = await import('../sendChatMessage');
        expect(mod).toBeDefined();
    });
});
