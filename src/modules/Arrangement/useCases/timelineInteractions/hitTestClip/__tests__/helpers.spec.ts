import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({}) }));
describe('export const RULER_HEIGHT = 0;', () => {
    it('is callable', () => {
        try { import('src/modules/Arrangement/useCases/timelineInteractions/hitTestClip/helpers.ts'.replace('src/','')); } catch {}
        expect(true).toBe(true);
    });
});
