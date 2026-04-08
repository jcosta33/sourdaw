import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setPunchOut } from './setPunchOut';
import { defaultTransportState } from '#/modules/Transport/models/TransportState';

describe('setPunchOut', () => {
    it('should clamp punch out beat and update transport', () => {
        const update = vi.fn();
        injectDependencies(setPunchOut, {
            getTransportState: vi.fn(() => ({ ...defaultTransportState })),
            updateTransportState: update,
        });

        setPunchOut(32);

        expect(update).toHaveBeenCalledWith({ punchOutBeat: 32 });
    });

    it('should not update when transport state is missing', () => {
        const update = vi.fn();
        injectDependencies(setPunchOut, {
            getTransportState: vi.fn(() => null),
            updateTransportState: update,
        });

        setPunchOut(8);

        expect(update).not.toHaveBeenCalled();
    });
});
