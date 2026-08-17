import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

import { stopRecording } from '../stopRecording';

import type { TakeLaneStoreState, takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import type { TransportState } from '#/modules/Transport/stores';
import type { TrackState, getTrackState } from '../../../repositories/track/getTrackState';
import type { setTrackState } from '../../../repositories/track/setTrackState';

const mocks = vi.hoisted(
    (): {
        getTrackState: Mock<typeof getTrackState>;
        setTrackState: Mock<typeof setTrackState>;
        transportStoreValue: TransportState | null;
        takeLaneStoreValue: { value: TakeLaneStoreState | null };
        takeLaneStoreSet: Mock<typeof takeLaneStore.set>;
        activeRecordingRef: { current: string[] };
    } => ({
        getTrackState: vi.fn<typeof import('../../../repositories/track/getTrackState').getTrackState>(),
        setTrackState: vi.fn<typeof import('../../../repositories/track/setTrackState').setTrackState>(),
        transportStoreValue: null,
        takeLaneStoreValue: { value: { lanes: [] } },
        takeLaneStoreSet: vi.fn<typeof import('#/modules/Arrangement/stores/takeLaneStore').takeLaneStore.set>(),
        activeRecordingRef: { current: ['c1'] },
    })
);

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

vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() {
            return mocks.takeLaneStoreValue.value;
        },
        set: mocks.takeLaneStoreSet,
    },
}));

vi.mock('../../../stores/activeRecordingRef', () => ({
    activeRecordingRef: mocks.activeRecordingRef,
}));

describe('stopRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.activeRecordingRef.current = ['c1'];
    });

    it('updates clip endBeat and clears active recording ref', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', type: 'audio', startBeat: 4, endBeat: 4 }],
                },
            ],
        } as unknown as TrackState);
        mocks.transportStoreValue = { playheadPosition: 8 } as unknown as TransportState;
        mocks.takeLaneStoreValue.value = null;

        stopRecording();

        expect(mocks.activeRecordingRef.current).toHaveLength(0);
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const newState = mocks.setTrackState.mock.calls[0]![0];
        expect(newState.tracks[0]!.clips[0]!.endBeat).toBe(8);
    });

    // Mid-playback the store's playheadPosition is still the beat playback
    // started at, which would close the take at (or before) its own start. The
    // caller names the end beat instead.
    it('closes clips and takes at an explicit beat, not the store playhead', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    clips: [{ id: 'c1', type: 'audio', startBeat: 4, endBeat: 4 }],
                },
            ],
        } as unknown as TrackState);
        mocks.transportStoreValue = { playheadPosition: 4 } as unknown as TransportState;
        mocks.takeLaneStoreValue.value = {
            lanes: [{ id: 'l1', takes: [{ clipId: 'c1', startBeat: 4, endBeat: 4 }] }],
        } as unknown as TakeLaneStoreState;

        stopRecording(12);

        const trackState = mocks.setTrackState.mock.calls[0]![0];
        expect(trackState.tracks[0]!.clips[0]!.endBeat).toBe(12);
        const laneState = mocks.takeLaneStoreSet.mock.calls[0]![0] as TakeLaneStoreState;
        expect(laneState.lanes[0]!.takes[0]!.endBeat).toBe(12);
    });

    it('enforces minimum 1 beat for MIDI clips', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1', type: 'midi', startBeat: 4, endBeat: 4 }] }],
        } as unknown as TrackState);
        mocks.transportStoreValue = { playheadPosition: 4.1 } as unknown as TransportState;

        stopRecording();

        const newState = mocks.setTrackState.mock.calls[0]![0];
        expect(newState.tracks[0]!.clips[0]!.endBeat).toBe(5); // 4 + 1
    });

    it('updates take lanes', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ clips: [] }] } as unknown as TrackState);
        mocks.transportStoreValue = { playheadPosition: 10 } as unknown as TransportState;
        mocks.takeLaneStoreValue.value = {
            lanes: [{ id: 'l1', takes: [{ clipId: 'c1', startBeat: 0, endBeat: 0 }] }],
        } as unknown as TakeLaneStoreState;

        stopRecording();

        expect(mocks.takeLaneStoreSet).toHaveBeenCalled();
        const newState = mocks.takeLaneStoreSet.mock.calls[0]![0];
        if (!newState) {
            throw new Error('expected takeLaneStore.set to receive a state');
        }
        expect(newState.lanes[0]!.takes[0]!.endBeat).toBe(10);
    });

    it('returns immediately when no clips are actively recording', () => {
        mocks.activeRecordingRef.current = [];
        mocks.getTrackState.mockReturnValue({ tracks: [{ clips: [] }] } as unknown as TrackState);
        mocks.transportStoreValue = { playheadPosition: 8 } as unknown as TransportState;

        stopRecording();

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.takeLaneStoreSet).not.toHaveBeenCalled();
    });

    it('returns without writing when the transport store has no state', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ clips: [] }] } as unknown as TrackState);
        mocks.transportStoreValue = null;

        stopRecording();

        expect(mocks.setTrackState).not.toHaveBeenCalled();
        expect(mocks.takeLaneStoreSet).not.toHaveBeenCalled();
    });

    it('leaves non-recording clips and takes untouched while finalising recording ones', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [
                {
                    clips: [
                        { id: 'c1', type: 'audio', startBeat: 0, endBeat: 0 },
                        { id: 'other', type: 'audio', startBeat: 0, endBeat: 2 },
                    ],
                },
            ],
        } as unknown as TrackState);
        mocks.transportStoreValue = { playheadPosition: 6 } as unknown as TransportState;
        mocks.takeLaneStoreValue.value = {
            lanes: [
                {
                    id: 'l1',
                    takes: [
                        { clipId: 'c1', startBeat: 0, endBeat: 0 },
                        { clipId: 'untouched', startBeat: 0, endBeat: 1 },
                    ],
                },
            ],
        } as unknown as TakeLaneStoreState;

        stopRecording();

        const trackState = mocks.setTrackState.mock.calls[0]![0];
        // Recording clip is finalised; the sibling clip keeps its end beat.
        expect(trackState.tracks[0]!.clips[0]!.endBeat).toBe(6);
        expect(trackState.tracks[0]!.clips[1]!.endBeat).toBe(2);

        const laneState = mocks.takeLaneStoreSet.mock.calls[0]![0] as TakeLaneStoreState;
        // Recording take is finalised; the unrelated take is unchanged.
        expect(laneState.lanes[0]!.takes[0]!.endBeat).toBe(6);
        expect(laneState.lanes[0]!.takes[1]!.endBeat).toBe(1);
    });
});
