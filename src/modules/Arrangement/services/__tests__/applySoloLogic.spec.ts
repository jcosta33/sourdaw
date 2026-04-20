import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setTrackMute, setTrackGain } from '#/modules/AudioEngine/useCases';
import { getWorkspaceState } from '#/modules/Workspace/useCases';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { applySoloLogic, resetSoloLogic } from '../applySoloLogic';

vi.mock('../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    setTrackMute: vi.fn(),
    setTrackGain: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    getWorkspaceState: vi.fn(),
}));

describe('applySoloLogic', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        resetSoloLogic();
    });

    describe('SIP (Solo In Place) mode', () => {
        beforeEach(() => {
            vi.mocked(getWorkspaceState).mockReturnValue({ soloMode: 'sip' } as any);
        });

        it('should follow individual mute states when no tracks are soloed', () => {
            const tracks = [
                TrackDummy.create({ id: 't1', muted: false, soloed: false }),
                TrackDummy.create({ id: 't2', muted: true, soloed: false }),
            ];
            vi.mocked(getTrackStoreState).mockReturnValue({ tracks } as any);

            applySoloLogic();

            expect(setTrackMute).toHaveBeenCalledWith('t1', false);
            expect(setTrackMute).toHaveBeenCalledWith('t2', true);
        });

        it('should mute non-soloed tracks when at least one track is soloed', () => {
            const tracks = [
                TrackDummy.create({ id: 't1', muted: false, soloed: true }),
                TrackDummy.create({ id: 't2', muted: false, soloed: false }),
            ];
            vi.mocked(getTrackStoreState).mockReturnValue({ tracks } as any);

            applySoloLogic();

            expect(setTrackMute).toHaveBeenCalledWith('t1', false);
            expect(setTrackMute).toHaveBeenCalledWith('t2', true);
        });

        it('should not mute solo-safe tracks even if other tracks are soloed', () => {
            const tracks = [
                TrackDummy.create({ id: 't1', muted: false, soloed: true }),
                TrackDummy.create({ id: 't-safe', muted: false, soloed: false, soloSafe: true }),
            ];
            vi.mocked(getTrackStoreState).mockReturnValue({ tracks } as any);

            applySoloLogic();

            expect(setTrackMute).toHaveBeenCalledWith('t1', false);
            expect(setTrackMute).toHaveBeenCalledWith('t-safe', false);
        });

        it('should unmute tracks routed to a soloed track', () => {
            const tracks = [
                TrackDummy.create({ id: 'bus', muted: false, soloed: true }),
                TrackDummy.create({ id: 'src', muted: false, soloed: false, outputId: 'bus' }),
            ];
            vi.mocked(getTrackStoreState).mockReturnValue({ tracks } as any);

            applySoloLogic();

            expect(setTrackMute).toHaveBeenCalledWith('bus', false);
            expect(setTrackMute).toHaveBeenCalledWith('src', false);
        });
    });

    describe('PFL (Pre-Fader Listen) mode', () => {
        beforeEach(() => {
            vi.mocked(getWorkspaceState).mockReturnValue({ soloMode: 'pfl' } as any);
        });

        it('should boost soloed track to 1.0 gain and save original gain', () => {
            const tracks = [
                TrackDummy.create({ id: 't1', gain: 0.5, soloed: true }),
                TrackDummy.create({ id: 't2', gain: 0.8, soloed: false }),
            ];
            vi.mocked(getTrackStoreState).mockReturnValue({ tracks } as any);

            applySoloLogic();

            expect(setTrackGain).toHaveBeenCalledWith('t1', 1.0);
            expect(setTrackMute).toHaveBeenCalledWith('t1', false);
            expect(setTrackMute).toHaveBeenCalledWith('t2', true);
        });

        it('should restore original gain when solo is cleared', () => {
            const t1 = TrackDummy.create({ id: 't1', gain: 0.5, soloed: true });
            const tracksSoloed = [t1, TrackDummy.create({ id: 't2', soloed: false })];

            vi.mocked(getTrackStoreState).mockReturnValue({ tracks: tracksSoloed } as any);
            applySoloLogic();
            expect(setTrackGain).toHaveBeenCalledWith('t1', 1.0);

            const tracksUnsoloed = [{ ...t1, soloed: false }, TrackDummy.create({ id: 't2', soloed: false })];
            vi.mocked(getTrackStoreState).mockReturnValue({ tracks: tracksUnsoloed } as any);

            applySoloLogic();
            expect(setTrackGain).toHaveBeenCalledWith('t1', 0.5);
        });
    });
});
