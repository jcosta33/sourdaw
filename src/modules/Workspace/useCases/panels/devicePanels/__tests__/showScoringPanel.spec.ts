import { describe, it, expect, vi } from 'vitest';

vi.mock('#/infra/di/inject', () => ({
    inject:
        <T extends Record<string, unknown>>(deps: T) =>
        (factory: (d: T) => unknown) =>
            factory(
                Object.fromEntries(
                    Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }])
                ) as T
            ),
}));
import { showScoringPanel } from '../showScoringPanel';

describe('showScoringPanel', () => {
    it('is a function', () => {
        expect(typeof showScoringPanel).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => (showScoringPanel as (id: string | null) => void)('test-id')).not.toThrow();
    });
});
