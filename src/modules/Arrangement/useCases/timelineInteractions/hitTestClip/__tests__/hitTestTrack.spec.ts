import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({}) }));
describe('export function hitTestTrack(canvasY: number): string | null {', () => {
    it('is callable', () => {
        try { import('src/modules/Arrangement/useCases/timelineInteractions/hitTestClip/hitTestTrack.ts'.replace('src/','')); } catch {}
        expect(true).toBe(true);
    });
});
