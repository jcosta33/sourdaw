import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setMetronomeVolume } from './setMetronomeVolume';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('setMetronomeVolume', () => {
    it('should clamp metronome volume between 0 and 1', () => {
        const update = vi.fn();
        injectDependencies(setMetronomeVolume, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setMetronomeVolume(1.5);

        expect(update).toHaveBeenCalledWith({ metronomeVolume: 1 });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(setMetronomeVolume, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        setMetronomeVolume(0.5);

        expect(update).not.toHaveBeenCalled();
    });
});
