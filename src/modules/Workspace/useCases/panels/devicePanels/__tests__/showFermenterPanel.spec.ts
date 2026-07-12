import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({
    inject: <T extends Record<string, unknown>>(deps: T) =>
        (factory: (d: T) => unknown) => factory(
            Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }])) as T
        ),
}));
import { showFermenterPanel } from '../showFermenterPanel';
describe('showFermenterPanel', () => {
    it('is a function', () => { expect(typeof showFermenterPanel).toBe('function'); });
    it('runs without crash', () => { expect(() => (showFermenterPanel as (id: string | null) => void)('test-id')).not.toThrow(); });
});
