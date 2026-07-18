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
import { showGrandBoulePanel } from '../showGrandBoulePanel';

describe('showGrandBoulePanel', () => {
    it('is a function', () => {
        expect(typeof showGrandBoulePanel).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => (showGrandBoulePanel as (id: string | null) => void)('test-id')).not.toThrow();
    });
});
