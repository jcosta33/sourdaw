import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDetectKey } from '../handleDetectKey';

const mocks = vi.hoisted(() => ({
    detectKey: vi.fn(),
    trackStore: { value: { tracks: [] } },
    notifyUser: vi.fn(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
}));

vi.mock('../../../useCases/keyDetection', () => ({
    detectKey: mocks.detectKey,
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

describe('handleDetectKey', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = { tracks: [] };
    });

    it('should bail out if the clip cannot be found', () => {
        mocks.trackStore.value = { tracks: [] };

        handleDetectKey.execute({ type: 'detectKey', payload: { clipId: 'c1' } });

        expect(mocks.detectKey).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('should bail out if the clip has no audioBufferId', () => {
        mocks.trackStore.value = {
            tracks: [{ clips: [{ id: 'c1' }] }],
        };

        handleDetectKey.execute({ type: 'detectKey', payload: { clipId: 'c1' } });

        expect(mocks.detectKey).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('should detect key and notify the user', () => {
        mocks.trackStore.value = {
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        };
        mocks.detectKey.mockReturnValue({ key: 'C', mode: 'major', confidence: 0.856 });

        handleDetectKey.execute({ type: 'detectKey', payload: { clipId: 'c1' } });

        expect(mocks.detectKey).toHaveBeenCalledWith('buf1');
        expect(mocks.notifyUser).toHaveBeenCalledWith('Detected key: C major (86% confidence)');
    });

    it('should notify the user if key cannot be detected', () => {
        mocks.trackStore.value = {
            tracks: [{ clips: [{ id: 'c1', audioBufferId: 'buf1' }] }],
        };
        mocks.detectKey.mockReturnValue(null);

        handleDetectKey.execute({ type: 'detectKey', payload: { clipId: 'c1' } });

        expect(mocks.notifyUser).toHaveBeenCalledWith('Could not detect key');
    });

    it('should provide a description', () => {
        const description = handleDetectKey.describe({ type: 'detectKey', payload: { clipId: 'c1' } });

        expect(description.label).toBe('Detect key from audio');
    });

    it('should not be undoable', () => {
        expect(handleDetectKey.undoable).toBe(false);
    });
});
