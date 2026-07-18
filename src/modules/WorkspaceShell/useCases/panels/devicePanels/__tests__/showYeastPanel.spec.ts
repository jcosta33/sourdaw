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
import { showYeastPanel } from '../showYeastPanel';

describe('showYeastPanel', () => {
    it('is a function', () => {
        expect(typeof showYeastPanel).toBe('function');
    });
    it('runs without crash', () => {
        expect(() => (showYeastPanel as (id: string | null) => void)('test-id')).not.toThrow();
    });
});
