import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setTrackMute } from '#/modules/AudioEngine/useCases/trackAudioControls/setTrackMute';
import { applySoloLogic } from '../../../services/applySoloLogic';
import { muteTrack } from '../muteTrack';

vi.mock('#/modules/AudioEngine/useCases/trackAudioControls/setTrackMute', () => ({
    setTrackMute: vi.fn(),
}));
vi.mock('../../../services/applySoloLogic', () => ({
    applySoloLogic: vi.fn(),
}));

const mockUpdateTrack = vi.fn();
vi.mock('#/modules/Arrangement/repositories/track/updateTrack', () => ({
    updateTrack: (...args: any[]) => mockUpdateTrack(...args)
}));

describe('muteTrack', () => {
    beforeEach(() => {
        vi.mocked(setTrackMute).mockClear();
        vi.mocked(applySoloLogic).mockClear();
        mockUpdateTrack.mockReset();
    });

    it('should update track mute, engine, and solo logic', () => {
        muteTrack('t1', true);

        expect(mockUpdateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(setTrackMute).toHaveBeenCalledWith('t1', true);
        expect(applySoloLogic).toHaveBeenCalledTimes(1);
    });
});
