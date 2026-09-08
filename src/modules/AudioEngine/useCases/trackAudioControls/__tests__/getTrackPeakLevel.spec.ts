import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: { getTrackPeakLevel: vi.fn() },
}));
vi.mock('../../livePlayback/readNativeEngineStripPeak', () => ({
    readNativeEngineStripPeak: vi.fn(),
}));

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { readNativeEngineStripPeak } from '../../livePlayback/readNativeEngineStripPeak';
import { getTrackPeakLevel } from '../getTrackPeakLevel';

describe('getTrackPeakLevel', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.getTrackPeakLevel).mockReset();
        vi.mocked(readNativeEngineStripPeak).mockReset();
    });

    it('prefers the native engine reading, including a true zero', () => {
        // `??`, never `||`: a native reading of exactly digital silence must
        // not fall through to the Web Audio analyser's own number.
        vi.mocked(readNativeEngineStripPeak).mockReturnValue(0);
        vi.mocked(audioEngine.getTrackPeakLevel).mockReturnValue(0.9);

        expect(getTrackPeakLevel('track-1')).toBe(0);
    });

    it('falls back to the web audio reading when the native side has nothing for this strip', () => {
        vi.mocked(readNativeEngineStripPeak).mockReturnValue(null);
        vi.mocked(audioEngine.getTrackPeakLevel).mockReturnValue(0.42);

        expect(getTrackPeakLevel('track-1')).toBe(0.42);
    });

    it('passes the requested track id through to both readers', () => {
        vi.mocked(readNativeEngineStripPeak).mockReturnValue(null);
        vi.mocked(audioEngine.getTrackPeakLevel).mockReturnValue(0);

        getTrackPeakLevel('track-42');

        expect(readNativeEngineStripPeak).toHaveBeenCalledWith('track-42');
        expect(audioEngine.getTrackPeakLevel).toHaveBeenCalledWith('track-42');
    });
});
