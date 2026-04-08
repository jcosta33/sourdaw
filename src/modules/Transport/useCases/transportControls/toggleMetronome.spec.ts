import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { toggleMetronome } from './toggleMetronome';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('toggleMetronome', () => {
    it('should flip metronomeEnabled when transport state exists', () => {
        const update = vi.fn();
        injectDependencies(toggleMetronome, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState, metronomeEnabled: false })),
            updateTransportState: update,
        });

        toggleMetronome();

        expect(update).toHaveBeenCalledWith({ metronomeEnabled: true });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(toggleMetronome, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        toggleMetronome();

        expect(update).not.toHaveBeenCalled();
    });
});
