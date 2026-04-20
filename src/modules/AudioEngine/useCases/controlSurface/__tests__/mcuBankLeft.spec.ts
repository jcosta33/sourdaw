import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ControlSurfaceState } from '../../../stores/controlSurface';
import { mcuBankLeft } from '../mcuBankLeft';

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

const baseState = (): ControlSurfaceState => ({
    protocol: null,
    mcu: {
        faders: Array.from({ length: 9 }, (_, i) => ({ position: 0, trackIndex: 8 + i })),
        bankOffset: 8,
        vpots: Array.from({ length: 8 }, () => 0),
        mode: 'pan',
        timecodeDisplay: '00:00:00:00',
        assignmentDisplay: 'PAN',
    },
    oscEndpoints: [],
    oscMappings: [],
    connected: false,
});

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
});
