import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }]))),
}));
vi.mock('#/helpers/createHandler', () => ({ createHandler: (config: unknown) => config }));
import { getCollaborationHandlers } from '../getCollaborationHandlers';
describe('getCollaborationHandlers', () => {
    it('is defined', () => {
        expect(getCollaborationHandlers).toBeDefined();
    });
});
