import { describe, it, expect, vi, beforeEach } from 'vitest';

import { readNativeEngineMasterPeak } from '../../livePlayback/readNativeEngineMasterPeak';
import { getMasterPeakLevel } from '../getMasterPeakLevel';

const webPeak = vi.hoisted(() => ({ value: null as number | null }));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        getMasterPeakLevel: () => webPeak.value,
    },
}));

vi.mock('../../livePlayback/readNativeEngineMasterPeak', () => ({
    readNativeEngineMasterPeak: vi.fn((): number | null => null),
}));

describe('getMasterPeakLevel', () => {
    beforeEach(() => {
        webPeak.value = 0.25;
        vi.mocked(readNativeEngineMasterPeak).mockReturnValue(null);
    });

    it('shows the louder carrier while both paths reach the device', () => {
        // The two carriers sum in the device, not in any node this app owns,
        // so the Out meter reports whichever side the peak came from.
        vi.mocked(readNativeEngineMasterPeak).mockReturnValue(0.75);

        expect(getMasterPeakLevel()).toBe(0.75);
    });

    it('keeps the web level when it is the louder of the two', () => {
        webPeak.value = 0.9;
        vi.mocked(readNativeEngineMasterPeak).mockReturnValue(0.75);

        expect(getMasterPeakLevel()).toBe(0.9);
    });

    it('reports the web level verbatim when no native session is audible', () => {
        expect(getMasterPeakLevel()).toBe(0.25);
    });

    it('reports the web level of null verbatim when no native session is audible', () => {
        // `null` is "nobody measured", and it has to survive: a meter that
        // turned it into 0 would claim a silent mix where there is no reading
        // at all.
        webPeak.value = null;

        expect(getMasterPeakLevel()).toBeNull();
    });

    it('reports the native level when Web Audio has no meter tap', () => {
        webPeak.value = null;
        vi.mocked(readNativeEngineMasterPeak).mockReturnValue(0.75);

        expect(getMasterPeakLevel()).toBe(0.75);
    });

    it('reports a measured native zero rather than nothing', () => {
        webPeak.value = null;
        vi.mocked(readNativeEngineMasterPeak).mockReturnValue(0);

        expect(getMasterPeakLevel()).toBe(0);
    });
});
