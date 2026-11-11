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
    it('isolates track identities within a frame and obtains fresh next-frame values', () => {
        vi.mocked(readNativeEngineStripPeak).mockReturnValue(null);
        vi.mocked(audioEngine.getTrackPeakLevel).mockImplementation((id) => (id === 'a' ? 0.5 : 0.25));
        expect(getTrackPeakLevel('a', 100)).toBe(0.5);
        expect(getTrackPeakLevel('b', 100)).toBe(0.25);
        vi.mocked(audioEngine.getTrackPeakLevel).mockReturnValue(0);
        expect(getTrackPeakLevel('a', 100)).toBe(0.5);
        expect(getTrackPeakLevel('b', 100)).toBe(0.25);
        expect(getTrackPeakLevel('a', 101)).toBe(0);
        expect(getTrackPeakLevel('b', 101)).toBe(0);
    });

    it('shares native measured zero without draining the web fallback and preserves immediate queries', () => {
        vi.mocked(readNativeEngineStripPeak).mockReturnValue(0);
        expect(getTrackPeakLevel('native', 200)).toBe(0);
        vi.mocked(readNativeEngineStripPeak).mockReturnValue(0.75);
        expect(getTrackPeakLevel('native', 200)).toBe(0);
        expect(audioEngine.getTrackPeakLevel).not.toHaveBeenCalled();
        expect(getTrackPeakLevel('native')).toBe(0.75);
        expect(getTrackPeakLevel('native', 201)).toBe(0.75);
    });
});
