import { describe, it, expect, vi, beforeEach } from 'vitest';

import { moveClip } from '../moveClip';

const mocks = vi.hoisted(() => {
    type MockClip = { id: string; trackId?: string; startBeat: number; endBeat: number };
    type MockTrack = { id: string; clips: MockClip[] };
    type MockTrackState = { tracks: MockTrack[] };
    return {
        getTrackState: vi.fn<() => MockTrackState>(),
        setTrackState: vi.fn<(state: MockTrackState) => void>(),
        shiftClipAutomation: vi.fn<(clipId: string, delta: number) => void>(),
        shiftClipMidiNotes: vi.fn<(clipId: string, delta: number) => void>(),
    };
});

vi.mock('#/modules/Arrangement/repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('#/modules/Arrangement/repositories/track/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('#/modules/Automation/useCases', () => ({
    shiftClipAutomation: mocks.shiftClipAutomation,
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    shiftClipMidiNotes: mocks.shiftClipMidiNotes,
}));

describe('moveClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('moves a clip between tracks and updates its position', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] },
                { id: 't2', clips: [] },
            ],
        });

        moveClip('c1', 't2', 10);

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const newState = mocks.setTrackState.mock.calls[0][0];

        expect(newState.tracks[0].clips).toHaveLength(0);
        expect(newState.tracks[1].clips).toHaveLength(1);
        expect(newState.tracks[1].clips[0]).toMatchObject({
            id: 'c1',
            trackId: 't2',
            startBeat: 10,
            endBeat: 14,
        });
    });

    it('shifts MIDI notes when moving', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
        });

        moveClip('c1', 't1', 5);

        // delta = 5 - 0 = 5
        expect(mocks.shiftClipMidiNotes).toHaveBeenCalledWith('c1', 5);
    });

    it('shifts automation when moving', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
        });

        moveClip('c1', 't1', 5);

        // delta = 5 - 0 = 5
        expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c1', 5);
    });

    it('respects originalStartBeat for automation delta if provided', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', clips: [{ id: 'c1', startBeat: 2, endBeat: 6 }] }],
        });

        // Current start is 2. Target is 10. Drag started at 0.
        // MIDI delta should be 10 - 2 = 8.
        // Automation delta should be 10 - 0 = 10.
        moveClip('c1', 't1', 10, 0);

        expect(mocks.shiftClipMidiNotes).toHaveBeenCalledWith('c1', 8);
        expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c1', 10);
    });

    it('bails if clip is not found', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', clips: [] }] });
        moveClip('c1', 't1', 10);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });
});
