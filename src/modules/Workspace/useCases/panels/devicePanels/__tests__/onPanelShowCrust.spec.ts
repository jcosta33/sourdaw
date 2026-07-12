import { describe, it, expect, vi } from 'vitest';
vi.mock('#/infra/di/inject', () => ({
    inject: <T extends Record<string, unknown>>(deps: T) =>
        (factory: (d: T) => unknown) => factory(
            Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }])) as T
        ),
}));
import { onPanelShowCrust } from '../onPanelShowCrust';
describe('onPanelShowCrust', () => {
    it('is a function', () => { expect(typeof onPanelShowCrust).toBe('function'); });
    it('accepts a handler and returns unsubscribe', () => {
        const result = (onPanelShowCrust as (h: () => void) => () => void)(vi.fn());
        expect(typeof result).toBe('function');
    });
});
