import { describe, expect, it } from 'vitest';

import { renderDiffSingerPhrase } from '../renderDiffSingerPhrase';

describe('renderDiffSingerPhrase', () => {
    it('fails closed without an admitted vocoder', async () => {
        await expect(
            renderDiffSingerPhrase({
                phraseId: 'phrase-1',
                voicebankId: 'voicebank-1',
                lyrics: 'la',
                notes: [{ pitch: 60, velocity: 100, startSec: 0, durationSec: 1 }],
                renderQuality: 'standard',
            })
        ).rejects.toThrow('Singing synthesis is unavailable until a compatible vocoder is admitted.');
    });
});
