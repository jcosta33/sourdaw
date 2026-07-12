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
import { onShowDevicePanel } from '../onShowDevicePanel';

describe('onShowDevicePanel', () => {
    it('is a function', () => {
        expect(typeof onShowDevicePanel).toBe('function');
    });
    it('accepts a handler and returns unsubscribe', () => {
        const result = (onShowDevicePanel as (h: () => void) => () => void)(vi.fn());
        expect(typeof result).toBe('function');
    });
});
