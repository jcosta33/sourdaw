import { describe, it, expect, vi, beforeEach } from 'vitest';

import { requestMicPermission } from '../requestMicPermission';
import { startAudioRecording } from '../startAudioRecording';
import { stopAudioRecording } from '../stopAudioRecording';

const mocks = vi.hoisted(() => ({
    startAudioRecordingRepo: vi.fn(),
    stopAudioRecordingRepo: vi.fn(),
    requestMicPermissionRepo: vi.fn(),
}));

vi.mock('../../../repositories/audioRecorder/recording', () => ({
    startAudioRecording: mocks.startAudioRecordingRepo,
    stopAudioRecording: mocks.stopAudioRecordingRepo,
}));

vi.mock('../../../repositories/audioRecorder/requestMicPermission', () => ({
    requestMicPermission: mocks.requestMicPermissionRepo,
}));

describe('AudioRecorder Use Cases', () => {
    beforeEach(() => vi.clearAllMocks());

    it('startAudioRecording delegates to repository', async () => {
        function onComplete() {}
        await startAudioRecording('t1', onComplete, 'in1');
        expect(mocks.startAudioRecordingRepo).toHaveBeenCalledWith('t1', onComplete, 'in1');
    });

    it('stopAudioRecording delegates to repository', () => {
        stopAudioRecording();
        expect(mocks.stopAudioRecordingRepo).toHaveBeenCalledTimes(1);
    });

    it('requestMicPermission delegates to repository', async () => {
        await requestMicPermission();
        expect(mocks.requestMicPermissionRepo).toHaveBeenCalledTimes(1);
    });
});
