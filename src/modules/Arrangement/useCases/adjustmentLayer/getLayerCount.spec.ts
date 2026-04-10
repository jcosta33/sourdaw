import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getLayerCount } from './getLayerCount';

describe('getLayerCount', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns layer count from the injected store', () => {
        injectDependencies(getLayerCount, {
            adjustmentLayerStore: {
                value: { layers: [{ id: 'l1' }, { id: 'l2' }] },
                set: vi.fn(),
            } as never,
        });

        expect(getLayerCount()).toBe(2);
    });

    it('returns 0 when store value is null', () => {
        injectDependencies(getLayerCount, {
            adjustmentLayerStore: {
                value: null,
                set: vi.fn(),
            } as never,
        });

        expect(getLayerCount()).toBe(0);
    });
});
