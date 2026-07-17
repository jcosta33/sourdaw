import { describe, it, expect, vi, beforeEach } from 'vitest';

import { applyGroove } from '../applyGroove';

type GrooveNote = { id: string; pitch: number; startBeat: number; duration: number; velocity: number };

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn(),
    setNotesForClip: vi.fn<(clipId: string, notes: GrooveNote[]) => void>(),
    getNotesForClip: vi.fn<(clipId: string) => GrooveNote[]>(),
    notesByClipId: {} as Record<string, GrooveNote[]>,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: mocks.getAllTracks,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    getNotesForClip: mocks.getNotesForClip,
    setNotesForClip: mocks.setNotesForClip,
}));

function setNotesCall(index: number): [string, GrooveNote[]] {
    const call = mocks.setNotesForClip.mock.calls[index];
    if (!call) {
        throw new Error(`Expected setNotesForClip call at index ${String(index)}`);
    }
    return call;
}

function noteAt(notes: GrooveNote[], index: number): GrooveNote {
    const note = notes[index];
    if (!note) {
        throw new Error(`Expected note at index ${String(index)}`);
    }
    return note;
}

describe('applyGroove', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.notesByClipId = {};
        mocks.getNotesForClip.mockImplementation((clipId: string) => mocks.notesByClipId[clipId] ?? []);
        mocks.getAllTracks.mockReturnValue([]);
    });

    it('bails if the clip has no notes (store empty)', () => {
        applyGroove('c1', { id: 'g1', name: 'Groove', offsets: [], velocities: [], subdivisions: 16 }, 1);
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('bails if clip has no notes', () => {
        mocks.notesByClipId = {};
        applyGroove('c1', { id: 'g1', name: 'Groove', offsets: [], velocities: [], subdivisions: 16 }, 1);
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();

        mocks.notesByClipId = { c1: [] };
        applyGroove('c1', { id: 'g1', name: 'Groove', offsets: [], velocities: [], subdivisions: 16 }, 1);
        expect(mocks.setNotesForClip).not.toHaveBeenCalled();
    });

    it('applies groove template offsets and velocities clamped to amount', () => {
        // Setup clip notes
        mocks.notesByClipId = {
            c1: [
                { id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                { id: 'n2', pitch: 60, startBeat: 1, duration: 1, velocity: 100 },
            ],
        };

        // Setup tracks to resolve clip length
        mocks.getAllTracks.mockReturnValue([
            {
                clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }],
            },
        ]);

        const template = {
            id: 'g1',
            name: 'Groove',
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

        expect(mocks.setNotesForClip).toHaveBeenCalledTimes(1);
        expect(setNotesCall(0)[0]).toBe('c1');
        const updatedNotes = setNotesCall(0)[1];

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
        mocks.notesByClipId = {
            c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
        };

        const template = {
            id: 'g1',
            name: 'Groove',
            subdivisions: 4,
            offsets: [0.5, 0, 0, 0],
            velocities: [1, 1, 1, 1],
        };
        applyGroove('c1', template, 1);

        const updatedNotes = setNotesCall(0)[1];
        expect(noteAt(updatedNotes, 0).startBeat).toBe(0.5);
    });

    it('clamps resulting startBeats to positive and velocity to 1-127', () => {
        mocks.notesByClipId = {
            c1: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 120 }],
        };

        const template = { id: 'g1', name: 'Groove', subdivisions: 1, offsets: [-1], velocities: [2] };
        applyGroove('c1', template, 1);

        const updatedNotes = setNotesCall(0)[1];
        expect(noteAt(updatedNotes, 0).startBeat).toBe(0); // 0 - 1 clamped to 0
        expect(noteAt(updatedNotes, 0).velocity).toBe(127); // 120 * 2 clamped to 127
    });
});
