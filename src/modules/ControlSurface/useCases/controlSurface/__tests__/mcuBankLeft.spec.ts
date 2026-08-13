import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ControlSurfaceState } from '../../../stores/controlSurface';
import { mcuBankLeft } from '../mcuBankLeft';

const mocks = vi.hoisted(() => ({
    state: null as ControlSurfaceState | null,
    set: vi.fn<(state: ControlSurfaceState) => void>(),
}));

vi.mock('../../../stores/controlSurface', () => ({
    controlSurfaceStore: {
        get value() {
            return mocks.state;
        },
        set: mocks.set,
    },
}));

function baseState(): ControlSurfaceState {
    return {
        protocol: null,
        mcu: {
            faders: Array.from({ length: 9 }, (_, index) => ({ position: 0, trackIndex: 8 + index })),
            bankOffset: 8,
            vpots: Array.from({ length: 8 }, () => 0),
            mode: 'pan',
            timecodeDisplay: '00:00:00:00',
            assignmentDisplay: 'PAN',
        },
        oscEndpoints: [],
        oscMappings: [],
        connected: false,
    };
}

describe('mcuBankLeft', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = baseState();
    });

    it('should not write when the control surface store is null', () => {
        mocks.state = null;

        mcuBankLeft();

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should decrease bank offset by 8 clamped at zero', () => {
        mcuBankLeft();

        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                mcu: expect.objectContaining({ bankOffset: 0 }),
            })
        );
    });

    it('should reassign channel faders 0-7 to the new bank offset and pin fader 8 to master (F-5)', () => {
        mcuBankLeft();

        const written = mocks.set.mock.calls[0]![0];
        const faders = written.mcu.faders;
        expect(faders.slice(0, 8).map((fader) => fader.trackIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        // Master (index 8) must stay pinned at its own identity, never
        // reassigned to a channel track index.
        expect(faders[8]?.trackIndex).toBe(16);
    });
});
