import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyGroove } from '../applyGroove';

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn(),
    midiStoreSet: vi.fn(),
    midiStoreValue: { value: null } as any,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/MIDI/stores', () => ({
    midiStore: {
        get value() {
            return mocks.midiStoreValue.value;
        },
        set: mocks.midiStoreSet,
    },
}));

describe('applyGroove', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.midiStoreValue.value = null;
        mocks.getAllTracks.mockReturnValue([]);
    });

    it('bails if midi store is unavailable', () => {
        applyGroove('c1', { id: 'g1', offsets: [], velocities: [], subdivisions: 16 }, 1);
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('bails if clip has no notes', () => {
        mocks.midiStoreValue.value = { notesByClipId: {} };
        applyGroove('c1', { id: 'g1', offsets: [], velocities: [], subdivisions: 16 }, 1);
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();

        mocks.midiStoreValue.value = { notesByClipId: { c1: [] } };
        applyGroove('c1', { id: 'g1', offsets: [], velocities: [], subdivisions: 16 }, 1);
        expect(mocks.midiStoreSet).not.toHaveBeenCalled();
    });

    it('applies groove template offsets and velocities clamped to amount', () => {
        // Setup clip notes
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [
                    { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                    { id: 'n2', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
                ],
            },
        };

        // Setup tracks to resolve clip length
        mocks.getAllTracks.mockReturnValue([
            {
                clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }],
            },
        ]);

        const template = {
            id: 'g1',
            subdivisions: 4, // 4 steps in 4 beats = 1 beat per step
            offsets: [0.1, -0.1, 0.2, -0.2], // beat 0, 1, 2, 3
            velocities: [1.2, 0.8, 1.1, 0.9],
        };

        applyGroove('c1', template, 0.5); // Apply at 50%

        // Expected calculation for note 1 (startBeat 0 -> step 0)
        // offset: 0.1 * 0.5 = 0.05
        // velScale: 1 + (1.2 - 1) * 0.5 = 1.1
        // newStart: 0 + 0.05 = 0.05
        // newVel: 100 * 1.1 = 110

        // Expected calculation for note 2 (startBeat 1 -> step 1)
        // offset: -0.1 * 0.5 = -0.05
        // velScale: 1 + (0.8 - 1) * 0.5 = 0.9
        // newStart: 1 + -0.05 = 0.95
        // newVel: 100 * 0.9 = 90

        expect(mocks.midiStoreSet).toHaveBeenCalledTimes(1);
        const updatedNotes = mocks.midiStoreSet.mock.calls[0][0].notesByClipId.c1;

        expect(updatedNotes[0]).toMatchObject({
            startBeat: 0.05,
            velocity: 110,
        });

        expect(updatedNotes[1]).toMatchObject({
            startBeat: 0.95,
            velocity: 90,
        });
    });

    it('falls back to length 4 if clip cannot be found', () => {
        // Just verify it doesn't crash
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
        };

        const template = { id: 'g1', subdivisions: 4, offsets: [0.5, 0, 0, 0], velocities: [1, 1, 1, 1] };
        applyGroove('c1', template, 1);

        const updatedNotes = mocks.midiStoreSet.mock.calls[0][0].notesByClipId.c1;
        expect(updatedNotes[0].startBeat).toBe(0.5);
    });

    it('clamps resulting startBeats to positive and velocity to 1-127', () => {
        mocks.midiStoreValue.value = {
            notesByClipId: {
                c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 120 }],
            },
        };

        const template = { id: 'g1', subdivisions: 1, offsets: [-1], velocities: [2] };
        applyGroove('c1', template, 1);

        const updatedNotes = mocks.midiStoreSet.mock.calls[0][0].notesByClipId.c1;
        expect(updatedNotes[0].startBeat).toBe(0); // 0 - 1 clamped to 0
        expect(updatedNotes[0].velocity).toBe(127); // 120 * 2 clamped to 127
    });
});
