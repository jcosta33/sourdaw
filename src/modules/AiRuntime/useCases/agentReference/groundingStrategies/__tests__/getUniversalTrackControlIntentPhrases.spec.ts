import { describe, expect, it } from 'vitest';

import { getUniversalTrackControlIntentPhrases } from '../getUniversalTrackControlIntentPhrases';

describe('getUniversalTrackControlIntentPhrases', () => {
    it('matches mute all audio tracks', () => {
        expect(getUniversalTrackControlIntentPhrases('mute all audio tracks')).toEqual(['mute all audio tracks']);
    });

    it('does not match a named mix mute with a leaving-unchanged qualifier', () => {
        const prompt =
            'Set Lead Vocal gain to 70%, pan Guitar Left 20% left and Guitar Right 20% right, and mute Room Mic, leaving the Drum Bus unchanged.';
        expect(getUniversalTrackControlIntentPhrases(prompt)).toEqual([]);
    });
});
