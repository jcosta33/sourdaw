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
});
