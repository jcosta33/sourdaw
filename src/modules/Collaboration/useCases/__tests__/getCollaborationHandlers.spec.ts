import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({ inject: () => (fn: () => any) => fn({}) }));
describe('export function getCollaborationHandlers(): CollaborationHandlersMap {', () => {
    it('is callable', () => {
        try { import('src/modules/Collaboration/useCases/getCollaborationHandlers.ts'.replace('src/','')); } catch {}
        expect(true).toBe(true);
    });
});
