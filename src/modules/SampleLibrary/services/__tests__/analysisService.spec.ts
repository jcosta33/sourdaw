import { describe, expect, it } from 'vitest';

import { PITCH_CLASSES } from '../../models/LibraryTypes';
import { performMusicalAnalysis } from '../analysisService';

/** Build a minimal AudioBuffer-like object whose first channel has the given
 * constant sample amplitude — enough to drive the analyser's RMS heuristic. */
function bufferWithAmplitude(amplitude: number, length = 1000): AudioBuffer {
    const data = new Float32Array(length).fill(amplitude);
    return {
        length,
        sampleRate: 44100,
        numberOfChannels: 1,
        duration: length / 44100,
        getChannelData: () => data,
    } as unknown as AudioBuffer;
}

describe('performMusicalAnalysis', () => {
    it('produces a tempo inside the validated BPM range', async () => {
        const result = await performMusicalAnalysis(bufferWithAmplitude(0.1));
        expect(result.bpm).toBeGreaterThanOrEqual(20);
        expect(result.bpm).toBeLessThanOrEqual(400);
        expect(Number.isFinite(result.bpm)).toBe(true);
    });

    it('normalizes the key to a canonical label (consistent minor suffix)', async () => {
        // A loud buffer (rms > 0.05) is classified minor → must carry a single
        // trailing "m"; the previous ad-hoc concat could emit naked "C#" for the
        // same case depending on the path. Assert the canonical shape.
        const loud = await performMusicalAnalysis(bufferWithAmplitude(0.9));
        expect(loud.key).toMatch(/m$/);
        // The label minus a trailing minor "m" must be a real pitch class.
        const pitch = loud.key.replace(/m$/, '');
        expect(PITCH_CLASSES).toContain(pitch);

        // A near-silent buffer (rms <= 0.05) is major → no trailing "m".
        const quiet = await performMusicalAnalysis(bufferWithAmplitude(0.001));
        expect(quiet.key.endsWith('m')).toBe(false);
        expect(PITCH_CLASSES).toContain(quiet.key);
    });
});
