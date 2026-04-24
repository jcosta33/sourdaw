import { describe, it, expect, vi, beforeEach } from 'vitest';

import { startRecording } from '../startRecording';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
    setTrackState: vi.fn(),
    transportStoreValue: null as unknown,
    addTakeLane: vi.fn(),
    addTake: vi.fn(),
    getTakeLaneForTrack: vi.fn(),
    activeRecordingRef: { current: [] },
}));

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
        expect(newClips[0]).toMatchObject({
            trackId: 't1',
            startBeat: 4,
            type: 'audio',
        });

        expect(mocks.addTakeLane).toHaveBeenCalledWith('t1');
        expect(mocks.addTake).toHaveBeenCalledWith('t1', newClips[0].id, expect.any(String), 4, 4);
        expect(mocks.setTrackState).toHaveBeenCalled();
        expect(mocks.activeRecordingRef.current).toContain(newClips[0].id);
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
});
