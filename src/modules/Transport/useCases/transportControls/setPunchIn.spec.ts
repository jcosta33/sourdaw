import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setPunchIn } from './setPunchIn';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('setPunchIn', () => {
    it('should clamp punch in beat and update transport', () => {
        const update = vi.fn();
        injectDependencies(setPunchIn, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setPunchIn(12);

        expect(update).toHaveBeenCalledWith({ punchInBeat: 12 });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(setPunchIn, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        setPunchIn(4);

        expect(update).not.toHaveBeenCalled();
    });
});
