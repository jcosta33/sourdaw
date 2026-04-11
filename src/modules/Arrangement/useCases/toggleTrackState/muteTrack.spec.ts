import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { setTrackMute } from '#/modules/AudioEngine/useCases/trackAudioControls/setTrackMute';
import { applySoloLogic } from '#/modules/Arrangement/services/applySoloLogic';
import { muteTrack } from './muteTrack';

vi.mock('#/modules/AudioEngine/useCases/trackAudioControls/setTrackMute', () => ({
    setTrackMute: vi.fn(),
}));
vi.mock('#/modules/Arrangement/services/applySoloLogic', () => ({
    applySoloLogic: vi.fn(),
}));

describe('muteTrack', () => {
    beforeEach(() => {
        vi.mocked(setTrackMute).mockClear();
        vi.mocked(applySoloLogic).mockClear();
    });

    it('should update track mute, engine, and solo logic', () => {
        const updateTrack = vi.fn();
        injectDependencies(muteTrack, { updateTrack });

        muteTrack('t1', true);

        expect(updateTrack).toHaveBeenCalledWith('t1', expect.any(Function));
        expect(setTrackMute).toHaveBeenCalledWith('t1', true);
        expect(applySoloLogic).toHaveBeenCalledTimes(1);
    });
});
