import { describe, it, expect, vi } from 'vitest';

vi.mock('#/infra/di/inject', () => ({
    inject: (deps: Record<string, unknown>) => (factory: (d: Record<string, unknown>) => unknown) =>
        factory(
            Object.fromEntries(Object.entries(deps).map(([k]) => [k, { emit: vi.fn(), on: vi.fn(() => () => {}) }]))
        ),
}));

import { addYeastProcessor } from '../addYeastProcessor';
import { removeYeastProcessor } from '../removeYeastProcessor';
import { reorderYeastProcessor } from '../reorderYeastProcessor';
import { setYeastProcessorBypass } from '../setYeastProcessorBypass';
import { setYeastProcessorParam } from '../setYeastProcessorParam';

describe('Yeast use cases', () => {
    it('addYeastProcessor is callable', () => {
        expect(typeof addYeastProcessor).toBe('function');
    });
    it('removeYeastProcessor is callable', () => {
        expect(typeof removeYeastProcessor).toBe('function');
    });
    it('setYeastProcessorBypass is callable', () => {
        expect(typeof setYeastProcessorBypass).toBe('function');
    });
    it('setYeastProcessorParam is callable', () => {
        expect(typeof setYeastProcessorParam).toBe('function');
    });
    it('reorderYeastProcessor is callable', () => {
        expect(typeof reorderYeastProcessor).toBe('function');
    });
});
