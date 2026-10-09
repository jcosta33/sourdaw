import { describe, it, expect, vi, beforeEach } from 'vitest';

import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack } from '#/modules/Arrangement/useCases';

import { startInputMonitoring as startInputMonitoringRepo } from '../../../repositories/audioRecorder/inputMonitoring';
import { getSelectedInputId } from '../../audioDeviceSelection/getSelectedInputId';
import { startInputMonitoring } from '../startInputMonitoring';

vi.mock('../../../repositories/audioRecorder/inputMonitoring', () => ({
    startInputMonitoring: vi.fn(),
}));

vi.mock('../../audioDeviceSelection/getSelectedInputId', () => ({
    getSelectedInputId: vi.fn(),
}));

describe('startInputMonitoring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(startInputMonitoringRepo).mockResolvedValue(true);
        vi.mocked(getSelectedInputId).mockReturnValue('selected-input');
        trackStore.set({
            tracks: [
                {
                    ...createTrack({ id: 'track-1', name: 'Input', kind: 'audio', withoutDefaultDevice: true }),
                    inputMonitoring: 'on',
                },
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
    });

    it('should preserve an explicit input id', async () => {
        await startInputMonitoring('track-1', 'explicit-input');

        expect(getSelectedInputId).not.toHaveBeenCalled();
        expect(startInputMonitoringRepo).toHaveBeenCalledWith('track-1', 'explicit-input', expect.any(Function));
    });

    it('should preserve null as the default-device input id', async () => {
        await startInputMonitoring('track-1', null);

        expect(getSelectedInputId).not.toHaveBeenCalled();
        expect(startInputMonitoringRepo).toHaveBeenCalledWith('track-1', null, expect.any(Function));
    });

    it('should resolve omitted input ids from the selected input use case', async () => {
        await startInputMonitoring('track-1');

        expect(getSelectedInputId).toHaveBeenCalledTimes(1);
        expect(startInputMonitoringRepo).toHaveBeenCalledWith('track-1', 'selected-input', expect.any(Function));
    });

    it('should resolve undefined input ids from the selected input use case', async () => {
        await startInputMonitoring('track-1', undefined);

        expect(getSelectedInputId).toHaveBeenCalledTimes(1);
        expect(startInputMonitoringRepo).toHaveBeenCalledWith('track-1', 'selected-input', expect.any(Function));
    });
});
