import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stopRecording } from '../stopRecording';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    setTrackState: vi.fn(),
    getTransportState: vi.fn(),
    takeLaneStoreValue: { value: { lanes: [] } },
    takeLaneStoreSet: vi.fn(),
    activeRecordingRef: { current: ['c1'] },
}));

vi.mock('../../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

vi.mock('../../../repositories/track/setTrackState', () => ({
    setTrackState: mocks.setTrackState,
}));

vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
    getTransportState: mocks.getTransportState,
}));

vi.mock('#/modules/Arrangement/stores/takeLaneStore', () => ({
    takeLaneStore: {
        get value() { return mocks.takeLaneStoreValue.value; },
        set: mocks.takeLaneStoreSet,
    }
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
                    clips: [{ id: 'c1', type: 'audio', startBeat: 4, endBeat: 4 }] 
                }
            ]
        });
        mocks.getTransportState.mockReturnValue({ playheadPosition: 8 });
        mocks.takeLaneStoreValue.value = null;

        stopRecording();

        expect(mocks.activeRecordingRef.current).toHaveLength(0);
        expect(mocks.setTrackState).toHaveBeenCalledTimes(1);
        const newState = mocks.setTrackState.mock.calls[0][0];
        expect(newState.tracks[0].clips[0].endBeat).toBe(8);
    });

    it('enforces minimum 1 beat for MIDI clips', () => {
        mocks.getTrackState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1', type: 'midi', startBeat: 4, endBeat: 4 }] }]
        });
        mocks.getTransportState.mockReturnValue({ playheadPosition: 4.1 });

        stopRecording();

        const newState = mocks.setTrackState.mock.calls[0][0];
        expect(newState.tracks[0].clips[0].endBeat).toBe(5); // 4 + 1
    });

    it('updates take lanes', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ clips: [] }] });
        mocks.getTransportState.mockReturnValue({ playheadPosition: 10 });
        mocks.takeLaneStoreValue.value = {
            lanes: [
                { id: 'l1', takes: [{ clipId: 'c1', startBeat: 0, endBeat: 0 }] }
            ]
        };

        stopRecording();

        expect(mocks.takeLaneStoreSet).toHaveBeenCalled();
        const newState = mocks.takeLaneStoreSet.mock.calls[0][0];
        expect(newState.lanes[0].takes[0].endBeat).toBe(10);
    });
});
