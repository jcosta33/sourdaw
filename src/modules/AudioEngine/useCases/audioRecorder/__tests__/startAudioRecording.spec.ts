import { describe, it, expect, vi, beforeEach } from 'vitest';

import { startAudioRecording as startAudioRecordingRepo } from '../../../repositories/audioRecorder/recording';
import { getSelectedInputId } from '../../audioDeviceSelection/getSelectedInputId';
import { startAudioRecording } from '../startAudioRecording';

vi.mock('../../../repositories/audioRecorder/recording', () => ({
    startAudioRecording: vi.fn(),
}));

vi.mock('../../audioDeviceSelection/getSelectedInputId', () => ({
    getSelectedInputId: vi.fn(),
}));

describe('startAudioRecording', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(startAudioRecordingRepo).mockResolvedValue(true);
        vi.mocked(getSelectedInputId).mockReturnValue('selected-input');
    });

    it('should preserve an explicit input id', async () => {
        const on_complete = vi.fn();

        await startAudioRecording('track-1', on_complete, 'explicit-input');

        expect(getSelectedInputId).not.toHaveBeenCalled();
        expect(startAudioRecordingRepo).toHaveBeenCalledWith('track-1', on_complete, 'explicit-input');
    });

    it('should preserve null as the default-device input id', async () => {
        const on_complete = vi.fn();

        await startAudioRecording('track-1', on_complete, null);

        expect(getSelectedInputId).not.toHaveBeenCalled();
        expect(startAudioRecordingRepo).toHaveBeenCalledWith('track-1', on_complete, null);
    });

    it('should resolve omitted input ids from the selected input use case', async () => {
        const on_complete = vi.fn();

        await startAudioRecording('track-1', on_complete);

        expect(getSelectedInputId).toHaveBeenCalledTimes(1);
        expect(startAudioRecordingRepo).toHaveBeenCalledWith('track-1', on_complete, 'selected-input');
    });

    it('should resolve undefined input ids from the selected input use case', async () => {
        const on_complete = vi.fn();

        await startAudioRecording('track-1', on_complete, undefined);

        expect(getSelectedInputId).toHaveBeenCalledTimes(1);
        expect(startAudioRecordingRepo).toHaveBeenCalledWith('track-1', on_complete, 'selected-input');
    });
});
