import { describe, it, expect, vi } from 'vitest';

vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(
            Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }]))
        ),
}));
vi.mock('#/helpers/createHandler', () => ({ createHandler: (config: unknown) => config }));
import { RULER_HEIGHT } from '../helpers';

describe('RULER_HEIGHT', () => {
    it('is defined', () => {
        expect(RULER_HEIGHT).toBeDefined();
    });
});
