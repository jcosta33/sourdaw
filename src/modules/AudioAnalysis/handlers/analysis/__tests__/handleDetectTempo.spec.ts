import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDetectTempo } from '../handleDetectTempo';

type TestTrackState = {
    tracks: Array<{ clips: Array<{ id: string; audioBufferId?: string }> }>;
};

const mocks = vi.hoisted(() => {
    const trackStore: { value: TestTrackState } = { value: { tracks: [] } };
    return {
        detectTempoFromBuffer: vi.fn(),
        detectProjectTempo: vi.fn(),
        trackStore,
        notifyUser: vi.fn(),
    };
});

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    detectProjectTempo: mocks.detectProjectTempo,
}));

vi.mock('../../../useCases/tempoDetection', () => ({
    detectTempo: mocks.detectTempoFromBuffer,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleDetectTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = { tracks: [] };
    });

    it('should detect tempo from a specific clip buffer if available', () => {
        mocks.trackStore.value = {
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        };
        mocks.detectTempoFromBuffer.mockReturnValue(125);

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.detectTempoFromBuffer).toHaveBeenCalledWith('buf1');
        expect(mocks.notifyUser).toHaveBeenCalledWith('Detected tempo: 125 BPM');
    });

    it('should notify failure if buffer tempo detection returns null', () => {
        mocks.trackStore.value = {
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        };
        mocks.detectTempoFromBuffer.mockReturnValue(null);

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.notifyUser).toHaveBeenCalledWith('Could not detect tempo');
    });

    it('should fall back to project tempo if clip buffer is missing', () => {
        mocks.trackStore.value = { tracks: [{ clips: [{ id: 'c1' }] }] };
        mocks.detectProjectTempo.mockReturnValue({ averageBpm: 120, minBpm: 110, maxBpm: 130, confidence: 0.8 });

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.detectProjectTempo).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Detected tempo: 120 BPM (110–130 range)', 'success');
    });

    it('should warn if project tempo confidence is too low', () => {
        mocks.trackStore.value = { tracks: [{ clips: [{ id: 'c1' }] }] };
        mocks.detectProjectTempo.mockReturnValue({ averageBpm: 120, minBpm: 110, maxBpm: 130, confidence: 0.3 });

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Could not confidently detect tempo — add more content first',
            'warning'
        );
    });

    it('should provide a description', () => {
        const description = handleDetectTempo.describe({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(description.label).toBe('Detect tempo');
    });

    it('is not undoable — it only reads tempo and notifies, mutating no state', () => {
        expect(handleDetectTempo.undoable).toBe(false);
    });
});
