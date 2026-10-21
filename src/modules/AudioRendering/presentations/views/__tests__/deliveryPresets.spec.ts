import { describe, expect, it } from 'vitest';

import { PODCAST_RSS_MP3_PRESET } from '../deliveryPresets';

describe('deliveryPresets', () => {
    it('offers only the shipped stereo RSS MP3 codec with explicit pre-encode targets', () => {
        expect(PODCAST_RSS_MP3_PRESET).toEqual({
            id: 'podcast-rss-mp3',
            name: 'Podcast RSS MP3',
            channels: 2,
            ceilingDbTp: -1,
            settings: {
                formats: ['mp3'],
                sampleRate: 44100,
                bitDepth: 24,
                mp3BitRate: 192,
                normalization: 'r128',
                targetLufs: -16,
            },
        });
    });
});
