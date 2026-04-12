import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startAudioRecording } from '../startAudioRecording';
import { stopAudioRecording } from '../stopAudioRecording';
import { requestMicPermission } from '../requestMicPermission';

const mocks = vi.hoisted(() => ({
    startAudioRecordingRepo: vi.fn(),
    stopAudioRecordingRepo: vi.fn(),
    requestMicPermissionRepo: vi.fn(),
}));

vi.mock('../../../repositories/audioRecorder/recording', () => ({
    startAudioRecording: mocks.startAudioRecordingRepo,
    stopAudioRecording: mocks.stopAudioRecordingRepo,
    requestMicPermission: mocks.requestMicPermissionRepo,
}));

describe('AudioRecorder Use Cases', () => {
    beforeEach(() => vi.clearAllMocks());

    it('startAudioRecording delegates to repository', async () => {
        const onComplete = () => {};
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
