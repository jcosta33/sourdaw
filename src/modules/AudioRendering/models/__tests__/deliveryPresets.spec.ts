import { describe, expect, it } from 'vitest';

import { DELIVERY_PRESETS } from '../deliveryPresets';

describe('factory delivery targets', () => {
    it('defines every required family with supported fields and honest descriptions', () => {
        expect(DELIVERY_PRESETS.map((preset) => preset.id)).toEqual([
            'spotify-stereo-master',
            'apple-music-stereo-master',
            'youtube-audio-master',
            'podcast-rss-mp3',
            'game-audio-pcm',
        ]);
        for (const preset of DELIVERY_PRESETS) {
            expect(preset.settings.formats.length).toBeGreaterThan(0);
            expect(preset.settings.channels).toBe(2);
            expect(preset.settings.bitDepth).toBe(24);
            expect(preset.settings.ceilingDbTp).toBe(-1);
            expect(preset.description.length).toBeGreaterThan(0);
        }
        expect(DELIVERY_PRESETS[0].settings.sampleRate).toBe('source');
        expect(DELIVERY_PRESETS[1].settings.sampleRate).toBe('source');
        expect(DELIVERY_PRESETS[2].name).toContain('for video');
        expect(DELIVERY_PRESETS[3].metadataFields).toEqual(['title', 'artist', 'description']);
        expect(DELIVERY_PRESETS[4].settings.normalization).toBe('off');
    });
});
