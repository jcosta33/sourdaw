import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ControlSurfaceState } from '../../../stores/controlSurface';
import { mcuBankRight } from '../mcuBankRight';

const mocks = vi.hoisted(() => ({
    state: null as ControlSurfaceState | null,
    set: vi.fn(),
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
            faders: Array.from({ length: 9 }, (_, i) => ({ position: 0, trackIndex: i })),
            bankOffset: 0,
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

describe('mcuBankRight', () => {
    beforeEach(() => {
        mocks.set.mockClear();
        mocks.state = baseState();
    });

    it('should not write when the control surface store is null', () => {
        mocks.state = null;

        mcuBankRight(16);

        expect(mocks.set).not.toHaveBeenCalled();
    });

    it('should advance bank offset by up to 8 within track range', () => {
        mcuBankRight(16);

        expect(mocks.set).toHaveBeenCalledWith(
            expect.objectContaining({
                mcu: expect.objectContaining({ bankOffset: 8 }),
            })
        );
    });
});
