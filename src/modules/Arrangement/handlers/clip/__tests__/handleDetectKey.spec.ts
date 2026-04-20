import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDetectKey } from '../handleDetectKey';

const mocks = vi.hoisted(() => ({
    detectKey: vi.fn(),
    getTrackStoreState: vi.fn(),
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    detectKey: mocks.detectKey,
}));

vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleDetectKey', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails out if the clip cannot be found', () => {
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        handleDetectKey.execute({ type: 'detectKey', payload: { clipId: 'c1' } });

        expect(mocks.detectKey).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('bails out if the clip has no audioBufferId', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1' }] }],
        });

        handleDetectKey.execute({ type: 'detectKey', payload: { clipId: 'c1' } });

        expect(mocks.detectKey).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('detects key and notifies user', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        });
        mocks.detectKey.mockReturnValue({ key: 'C', mode: 'Major', confidence: 0.856 });

        handleDetectKey.execute({ type: 'detectKey', payload: { clipId: 'c1' } });

        expect(mocks.detectKey).toHaveBeenCalledWith('buf1');
        expect(mocks.notifyUser).toHaveBeenCalledWith('Detected key: C Major (86% confidence)');
    });

    it('notifies user if key cannot be detected', () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        });
        mocks.detectKey.mockReturnValue(null);

        handleDetectKey.execute({ type: 'detectKey', payload: { clipId: 'c1' } });

        expect(mocks.notifyUser).toHaveBeenCalledWith('Could not detect key');
    });

    it('provides a description', () => {
        const desc = handleDetectKey.describe({ type: 'detectKey', payload: { clipId: 'c1' } });
        expect(desc.label).toBe('Detect key from audio');
    });

    it('is not undoable', () => {
        expect(handleDetectKey.undoable).toBe(false);
    });
});
