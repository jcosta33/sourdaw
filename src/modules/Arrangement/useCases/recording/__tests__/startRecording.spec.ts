import { describe, it, expect, vi, beforeEach } from 'vitest';

import { startRecording } from '../startRecording';

const mocks = vi.hoisted(() => {
    const transportStoreValue: unknown = null;
    return {
        getTrackState: vi.fn(),
        setTrackState: vi.fn(),
        transportStoreValue,
        addTakeLane: vi.fn(),
        addTake: vi.fn(),
        getTakeLaneForTrack: vi.fn(),
        activeRecordingRef: { current: [] },
    };
});

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {
        get value() {
            return mocks.transportStoreValue;
        },
    },
}));

vi.mock('#/modules/Arrangement/useCases/comping/addTakeLane', () => ({
    addTakeLane: mocks.addTakeLane,
}));

vi.mock('#/modules/Arrangement/useCases/comping/addTake', () => ({
    addTake: mocks.addTake,
}));

vi.mock('#/modules/Arrangement/useCases/comping/getTakeLaneForTrack', () => ({
    getTakeLaneForTrack: mocks.getTakeLaneForTrack,
}));

vi.mock('../../../stores/activeRecordingRef', () => ({
    activeRecordingRef: mocks.activeRecordingRef,
}));

describe('startRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.activeRecordingRef.current = [];
    });

    it('creates clips and takes for armed tracks', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', armed: true, kind: 'audio', clips: [] },
                { id: 't2', armed: false, kind: 'midi', clips: [] },
            ],
        });
        mocks.transportStoreValue = { playheadPosition: 4 };
        mocks.getTakeLaneForTrack.mockReturnValue(null);

        const newClips = startRecording();

        expect(newClips).toHaveLength(1);
        const firstClip = newClips[0];
        if (!firstClip) {
            throw new Error('expected a recorded clip');
        }
        expect(firstClip).toMatchObject({
            trackId: 't1',
            startBeat: 4,
            type: 'audio',
        });

        expect(mocks.addTakeLane).toHaveBeenCalledWith('t1');
        expect(mocks.addTake).toHaveBeenCalledWith('t1', firstClip.id, expect.any(String), 4, 4);
        expect(mocks.setTrackState).toHaveBeenCalled();
        expect(mocks.activeRecordingRef.current).toContain(firstClip.id);
    });

    it('skips MIDI clip creation if overdubbing onto existing clip', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', armed: true, kind: 'midi', clips: [{ id: 'c1', type: 'midi', startBeat: 0, endBeat: 10 }] },
            ],
        });
        mocks.transportStoreValue = {
            playheadPosition: 5,
            overdubEnabled: true,
        };

        const newClips = startRecording();

        expect(newClips).toHaveLength(0);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('creates a midi-typed clip for an armed midi track with no existing clip', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', armed: true, kind: 'midi', clips: [] }],
        });
        mocks.transportStoreValue = { playheadPosition: 4 };
        mocks.getTakeLaneForTrack.mockReturnValue(null);

        const newClips = startRecording();

        expect(newClips).toHaveLength(1);
        expect(newClips[0]).toMatchObject({ trackId: 't1', type: 'midi' });
    });

    it('excludes an armed dormant VCA before clip, take, or store work', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 'vca-1', armed: true, kind: 'vca', clips: [] }],
        });
        mocks.transportStoreValue = { playheadPosition: 4 };

        expect(startRecording()).toEqual([]);
        expect(mocks.getTakeLaneForTrack).not.toHaveBeenCalled();
        expect(mocks.addTakeLane).not.toHaveBeenCalled();
        expect(mocks.addTake).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('returns empty when the transport store has no state, even with armed tracks', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', armed: true, kind: 'audio', clips: [] }],
        });
        mocks.transportStoreValue = null;

        expect(startRecording()).toEqual([]);
        expect(mocks.getTakeLaneForTrack).not.toHaveBeenCalled();
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    // The transport store's playheadPosition is written on discrete events only
    // (start/stop/pause/seek), so during playback it holds the beat playback
    // *started* at. Every caller that records from a moving transport therefore
    // has to name the beat, and that beat — not the store's — has to anchor the
    // clip and its take.
    it('anchors the clip and its take at an explicit beat, not the store playhead', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ id: 't1', armed: true, kind: 'audio', clips: [] }],
        });
        mocks.transportStoreValue = { playheadPosition: 4 };
        mocks.getTakeLaneForTrack.mockReturnValue(null);

        const newClips = startRecording(16);

        const firstClip = newClips[0];
        if (!firstClip) {
            throw new Error('expected a recorded clip');
        }
        expect(firstClip).toMatchObject({ trackId: 't1', startBeat: 16, endBeat: 16 });
        expect(mocks.addTake).toHaveBeenCalledWith('t1', firstClip.id, expect.any(String), 16, 16);
    });

    it('resolves the overdub intersection against the explicit beat', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                { id: 't1', armed: true, kind: 'midi', clips: [{ id: 'c1', type: 'midi', startBeat: 8, endBeat: 12 }] },
            ],
        });
        // The store playhead (0) sits outside the existing clip, so only the
        // explicit beat can put the recording inside it and merge the overdub.
        mocks.transportStoreValue = { playheadPosition: 0, overdubEnabled: true };

        expect(startRecording(9)).toHaveLength(0);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });

    it('skips MIDI clip creation when overdubbing inside an active loop region', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    armed: true,
                    kind: 'midi',
                    // A midi clip that fits entirely inside the loop region.
                    clips: [{ id: 'c1', type: 'midi', startBeat: 2, endBeat: 4 }],
                },
            ],
        });
        // Playhead is inside the loop region [0,8] but outside the clip [2,4],
        // so no clip intersects the playhead directly — yet the loop-clip merge
        // path still suppresses a fresh clip because the loop hosts the take.
        mocks.transportStoreValue = {
            playheadPosition: 6,
            overdubEnabled: true,
            isLooping: true,
            loopStart: 0,
            loopEnd: 8,
        };

        expect(startRecording()).toHaveLength(0);
        expect(mocks.setTrackState).not.toHaveBeenCalled();
    });
});
