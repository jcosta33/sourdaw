import { describe, it, expect, vi, beforeEach } from 'vitest';

import { undoRippleDelete } from '../undoRippleDelete';

const mocks = vi.hoisted(() => ({
    getTrackStoreState: vi.fn(),
    setTrackState: vi.fn(),
    shiftClipAutomation: vi.fn(),
    getAutomationLanes: vi.fn(),
    restoreAutomationLanes: vi.fn(),
    writeClipSatelliteEntry: vi.fn(),
}));

vi.mock('#/modules/Automation/useCases', () => ({
    shiftClipAutomation: mocks.shiftClipAutomation,
    getAutomationLanes: mocks.getAutomationLanes,
    restoreAutomationLanes: mocks.restoreAutomationLanes,
}));

vi.mock('../../getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('../../setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('../../../stores/clipSatelliteState', () => ({
    writeClipSatelliteEntry: mocks.writeClipSatelliteEntry,
}));

describe('undoRippleDelete', () => {
    beforeEach(() => vi.clearAllMocks());

    it('restores removed clips and shifts back shifted clips', () => {
        const shiftedClip = { id: 'c3', startBeat: 6, endBeat: 10 }; // Currently at 6
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [shiftedClip] }],
        });

        undoRippleDelete({
            trackId: 't1',
            removedClips: [{ id: 'c2', startBeat: 4, endBeat: 8 } as any],
            shiftedClips: [{ clipId: 'c3', origStartBeat: 10, origEndBeat: 14, automationDelta: -4 }],
        });

        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const setCall = mocks.setTrackState.mock.calls[0];
        if (!setCall) {
            throw new Error('expected setTrackState to be called');
        }
        const newState = setCall[0];
        const track = newState.tracks[0];

        expect(track.clips).toHaveLength(2);

        // c3 shifted back to 10
        const c3 = track.clips.find((context: any) => context.id === 'c3');
        expect(c3).toMatchObject({ startBeat: 10, endBeat: 14 });
        expect(mocks.shiftClipAutomation).toHaveBeenCalledWith('c3', 4);

        // c2 restored
        const c2 = track.clips.find((context: any) => context.id === 'c2');
        expect(c2).toMatchObject({ id: 'c2', startBeat: 4, endBeat: 8 });
    });

    it('restores a removed clip gain envelope, warp state, and automation lanes captured before retirement', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [] }],
        });
        const gainEnvelope = { clipId: 'c2', points: [{ id: 'p1', beatOffset: 0, gainDb: -6 }], enabled: true };
        const clipSatellites = [{ clipId: 'c2', gainEnvelope, warpState: null }];
        const lane = {
            id: 'lane-1',
            trackId: 't1',
            clipId: 'c2',
            parameterId: 'gain',
            parameterName: 'Gain',
            points: [],
            objects: [],
            visible: true,
            enabled: true,
            collapsed: false,
            minValue: 0,
            maxValue: 1,
        };

        undoRippleDelete({
            trackId: 't1',
            removedClips: [{ id: 'c2', startBeat: 4, endBeat: 8 } as any],
            shiftedClips: [],
            clipSatellites,
            clipAutomationLanes: [lane],
        });

        expect(mocks.writeClipSatelliteEntry).toHaveBeenCalledWith(clipSatellites[0]);
        expect(mocks.restoreAutomationLanes).toHaveBeenCalledWith([lane]);
    });

    it('does not touch satellite stores when the ripple carried none', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [] }],
        });

        undoRippleDelete({
            trackId: 't1',
            removedClips: [{ id: 'c2', startBeat: 4, endBeat: 8 } as any],
            shiftedClips: [],
        });

        expect(mocks.writeClipSatelliteEntry).not.toHaveBeenCalled();
        expect(mocks.restoreAutomationLanes).not.toHaveBeenCalled();
    });

    it('is a no-op when there is no track state', () => {
        mocks.getTrackStoreState.mockReturnValue(null);

        undoRippleDelete({ trackId: 't1', removedClips: [], shiftedClips: [] });

        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('leaves tracks other than the target untouched', () => {
        const otherClip = { id: 'c-other', startBeat: 0, endBeat: 4 };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                { id: 'other', clips: [otherClip] },
                { id: 't1', clips: [{ id: 'c1', startBeat: 2, endBeat: 6 }] },
            ],
        });

        undoRippleDelete({
            trackId: 't1',
            removedClips: [],
            shiftedClips: [{ clipId: 'c1', origStartBeat: 8, origEndBeat: 12, automationDelta: -6 }],
        });

        const newState = mocks.setTrackState.mock.calls[0]?.[0];
        // the non-target track is returned unchanged
        expect(newState.tracks[0].clips).toEqual([otherClip]);
    });

    it('leaves clips with no recorded shift in place', () => {
        const unshifted = { id: 'c-unshifted', startBeat: 0, endBeat: 4 };
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', clips: [unshifted] }],
        });

        undoRippleDelete({ trackId: 't1', removedClips: [], shiftedClips: [] });

        const newState = mocks.setTrackState.mock.calls[0]?.[0];
        const clip = newState.tracks[0].clips[0];
        // no shift entry → returned unchanged
        expect(clip).toMatchObject({ startBeat: 0, endBeat: 4 });
    });
});
