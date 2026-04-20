import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDetectTempo } from '../handleDetectTempo';

const mocks = vi.hoisted(() => ({
    detectTempoFromBuffer: vi.fn(),
    detectProjectTempo: vi.fn(),
    getTrackStoreState: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    detectTempo: mocks.detectTempoFromBuffer,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    detectProjectTempo: mocks.detectProjectTempo,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleDetectTempo', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('detects tempo from specific clip buffer if available', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        });
        mocks.detectTempoFromBuffer.mockReturnValue(125);

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.detectTempoFromBuffer).toHaveBeenCalledWith('buf1');
        expect(mocks.notifyUser).toHaveBeenCalledWith('Detected tempo: 125 BPM');
    });

    it('notifies failure if buffer tempo detection returns null', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        });
        mocks.detectTempoFromBuffer.mockReturnValue(null);

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.notifyUser).toHaveBeenCalledWith('Could not detect tempo');
    });

    it('falls back to detecting overall project tempo if clip buffer is missing', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ clips: [{ id: 'c1' }] }] });
        mocks.detectProjectTempo.mockReturnValue({ averageBpm: 120, minBpm: 110, maxBpm: 130, confidence: 0.8 });

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.detectProjectTempo).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith('Detected tempo: 120 BPM (110–130 range)', 'success');
    });

    it('warns if project tempo detection confidence is too low', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ clips: [{ id: 'c1' }] }] });
        mocks.detectProjectTempo.mockReturnValue({ averageBpm: 120, minBpm: 110, maxBpm: 130, confidence: 0.3 });

        handleDetectTempo.execute({ type: 'detectTempo', payload: { clipId: 'c1' } });

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Could not confidently detect tempo — add more content first',
            'warning'
        );
    });

    it('provides a description', () => {
        const desc = handleDetectTempo.describe({ type: 'detectTempo', payload: { clipId: 'c1' } });
        expect(desc.label).toBe('Detect tempo');
    });

    it('is undoable', () => {
        expect(handleDetectTempo.undoable).toBe(true);
    });
});
