import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ControlSurfaceState } from '../../../stores/controlSurface';
import { mcuBankRight } from '../mcuBankRight';

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
            faders: Array.from({ length: 9 }, (_, index) => ({ position: 0, trackIndex: index })),
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

    it('should assign channel faders 0-7 to the new bank offset and pin fader 8 to master (F-5)', () => {
        mcuBankRight(16);

        const written = mocks.set.mock.calls[0]![0];
        const faders = written.mcu.faders;
        expect(faders.slice(0, 8).map((fader) => fader.trackIndex)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
        // Master (index 8) must stay pinned at its own identity, never
        // reassigned to a channel track index.
        expect(faders[8]?.trackIndex).toBe(8);
    });

    it('should not resolve the master fader past the last track when the bank offset caps (F-5)', () => {
        // 10 tracks: maxOffset = 10 - 8 = 2. Pre-fix, fader 8 (master) resolved
        // to bankOffset + 8 = 10 — one past the last valid track index (9).
        mcuBankRight(10);

        const written = mocks.set.mock.calls[0]![0];
        expect(written.mcu.bankOffset).toBe(2);
        expect(written.mcu.faders[8]?.trackIndex).toBe(8);
        expect(written.mcu.faders[7]?.trackIndex).toBe(9);
    });

    it('should clamp channel fader track indices to the last track when there are fewer than 8 tracks (F-5)', () => {
        mcuBankRight(3);

        const written = mocks.set.mock.calls[0]![0];
        const channelIndices = written.mcu.faders.slice(0, 8).map((fader) => fader.trackIndex);
        for (const trackIndex of channelIndices) {
            expect(trackIndex).toBeLessThanOrEqual(2);
        }
    });
});
