import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setPreRollBars } from './setPreRollBars';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('setPreRollBars', () => {
    it('should clamp pre-roll bars between 1 and 8', () => {
        const update = vi.fn();
        injectDependencies(setPreRollBars, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setPreRollBars(20);

        expect(update).toHaveBeenCalledWith({ preRollBars: 8 });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(setPreRollBars, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        setPreRollBars(2);

        expect(update).not.toHaveBeenCalled();
    });
});
