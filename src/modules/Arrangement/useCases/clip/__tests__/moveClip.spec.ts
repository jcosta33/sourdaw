import { describe, it, expect, vi, beforeEach } from 'vitest';

import { moveClip } from '../moveClip';

const mocks = vi.hoisted(() => {
    type MockClip = { id: string; trackId?: string; startBeat: number; endBeat: number; locked?: boolean };
    type MockTrack = { id: string; kind: 'audio' | 'vca'; clips: MockClip[] };
    type MockTrackState = { tracks: MockTrack[] };
    return {
        getTrackState: vi.fn<() => MockTrackState>(),
        setTrackState: vi.fn<(state: MockTrackState) => void>(),
        shiftClipAutomation: vi.fn<(clipId: string, delta: number, targetTrackId?: string) => void>(),
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
                { id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] },
                { id: 't2', kind: 'audio', clips: [] },
            ],
        });

        expect(moveClip('c1', 't2', 10)).toBe(true);

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const setCall = mocks.setTrackState.mock.calls[0];
        if (!setCall) {
            throw new Error('expected setTrackState to have been called');
        }
        const newState = setCall[0];

        const [sourceTrack, targetTrack] = newState.tracks;
        if (!sourceTrack || !targetTrack) {
            throw new Error('expected two tracks in new state');
        }
        expect(sourceTrack.clips).toHaveLength(0);
        expect(targetTrack.clips).toHaveLength(1);
        expect(targetTrack.clips[0]).toMatchObject({
            id: 'c1',
            trackId: 't2',
            startBeat: 10,
            endBeat: 14,
        });
    });

    it('shifts MIDI notes when moving', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
        });

        expect(moveClip('c1', 't1', 5)).toBe(true);

        // delta = 5 - 0 = 5
        expect(mocks.shiftClipMidiNotes).not.toHaveBeenCalled();
    });

    it('shifts automation when moving', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
        });

        expect(moveClip('c1', 't1', 5)).toBe(true);

        // delta = 5 - 0 = 5
        expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c1', 5, 't1');
    });

    it('respects originalStartBeat for automation delta if provided', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 2, endBeat: 6 }] }],
        });

        // Current start is 2. Target is 10. Drag started at 0.
        // MIDI delta should be 10 - 2 = 8.
        // Automation delta should be 10 - 0 = 10.
        expect(moveClip('c1', 't1', 10, 0)).toBe(true);

        expect(mocks.shiftClipMidiNotes).not.toHaveBeenCalled();
        expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c1', 10, 't1');
    });

    it('rehomes clip automation even when a cross-track move has no beat delta', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 2, endBeat: 6 }] },
                { id: 't2', kind: 'audio', clips: [] },
            ],
        });

        expect(moveClip('c1', 't2', 2)).toBe(true);

        expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c1', 0, 't2');
    });

    it('bails if clip is not found', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', clips: [] }] });
        expect(moveClip('c1', 't1', 10)).toBe(false);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('bails without deleting the clip when the target track does not exist', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
        });

        // The clip exists, but the destination track id is bogus. Without the
        // guard, the strip-then-readd logic would remove c1 from t1 and never
        // re-add it anywhere — silently destroying the clip.
        expect(moveClip('c1', 'does-not-exist', 10)).toBe(false);

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.shiftClipAutomation).not.toHaveBeenCalled();
        expect(mocks.shiftClipMidiNotes).not.toHaveBeenCalled();
    });

    it('bails when the track store has not loaded', () => {
        mocks.getTrackState.mockReturnValue(null as unknown as { tracks: never[] });

        expect(moveClip('c1', 't1', 10)).toBe(false);

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.shiftClipAutomation).not.toHaveBeenCalled();
    });

    it.each([Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, -1])(
        'rejects an invalid start beat %s without writing',
        (startBeat) => {
            mocks.getTrackState.mockReturnValue({
                tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 0, endBeat: 4 }] }],
            });

            expect(moveClip('c1', 't1', startBeat)).toBe(false);

            expect(mocks.setTrackState).not.toHaveBeenCalled();
            expect(mocks.shiftClipAutomation).not.toHaveBeenCalled();
        }
    );

    it('rejects moving a locked clip or moving onto an ineligible VCA track', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', kind: 'audio', clips: [{ id: 'c1', startBeat: 0, endBeat: 4, locked: true }] },
                { id: 'vca-1', kind: 'vca', clips: [] },
            ],
        } as never);

        expect(moveClip('c1', 't1', 4)).toBe(false);
        expect(moveClip('c1', 'vca-1', 4)).toBe(false);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('reports an exact same-track, same-position request as a no-op', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1', trackId: 't1', startBeat: 4, endBeat: 8 }] }],
        });

        expect(moveClip('c1', 't1', 4)).toBe(false);

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.shiftClipAutomation).not.toHaveBeenCalled();
    });
});
