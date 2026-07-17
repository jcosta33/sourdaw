import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyGrooveToClip } from '../applyGrooveToClip';

const mocks = vi.hoisted(() => ({
    midiStoreValue: { value: { notesByClipId: {} } },
    midiStoreSet: vi.fn(),
}));

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

describe('applyGrooveToClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shifts notes and scales velocities based on groove template', () => {
        const mockNotes = [
            { id: 'n1', startBeat: 0, velocity: 100, pitch: 60 }, // On grid (step 0)
            { id: 'n2', startBeat: 0.5, velocity: 100, pitch: 64 }, // On grid (step 2 if division is 0.25)
        ];
        mocks.midiStoreValue.value = { notesByClipId: { c1: mockNotes } } as any;

        const mockGroove = {
            gridDivision: 0.25,
            offsets: [
                { gridPosition: 0, timingOffset: 0.1, velocityScale: 1.2 },
                { gridPosition: 2, timingOffset: -0.05, velocityScale: 0.8 },
            ],
        };

        applyGrooveToClip('c1', mockGroove as any, 1.0);

        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const setCall = mocks.midiStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('Expected midiStore.set call');
        }
        const updated = setCall[0].notesByClipId.c1;

        // Note 1 (step 0): offset 0.1, vel scale 1.2
        expect(updated[0].startBeat).toBeCloseTo(0.1);
        expect(updated[0].velocity).toBe(120);

        // Note 2 (step 2): offset -0.05, vel scale 0.8
        expect(updated[1].startBeat).toBeCloseTo(0.45);
        expect(updated[1].velocity).toBe(80);
    });

    it('respects the amount parameter', () => {
        mocks.midiStoreValue.value = { notesByClipId: { c1: [{ id: 'n1', startBeat: 0, velocity: 100 }] } } as any;
        const mockGroove = {
            gridDivision: 0.25,
            offsets: [{ gridPosition: 0, timingOffset: 0.2, velocityScale: 1.5 }],
        };

        // Apply at 50%
        applyGrooveToClip('c1', mockGroove as any, 0.5);

        const setCall = mocks.midiStoreSet.mock.calls[0];
        if (!setCall) {
            throw new Error('Expected midiStore.set call');
        }
        const updated = setCall[0].notesByClipId.c1;
        // timing: 0 + (0.2 * 0.5) = 0.1
        // velocity: 100 * (1 + (1.5 - 1) * 0.5) = 100 * 1.25 = 125
        expect(updated[0].startBeat).toBeCloseTo(0.1);
        expect(updated[0].velocity).toBe(125);
    });
});
