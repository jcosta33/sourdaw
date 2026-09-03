import { describe, expect, it } from 'vitest';

import { hasHighLevelCreationEvidence } from '../hasHighLevelCreationEvidence';

describe('hasHighLevelCreationEvidence', () => {
    it.each([
        'create a blues song with a twelve bar progression',
        'make a drum track and a bass track',
        'build me a lo-fi beat',
        'lay down a groove in E',
        'set up a session with 3 midi tracks',
        'compose a jazz progression',
    ])('reads a request for something new as creation evidence: %s', (request) => {
        expect(hasHighLevelCreationEvidence(request)).toBe(true);
    });

    it.each([
        'make the drums louder',
        'do not create a song',
        'never create a track',
        'write the melody down an octave',
        'mute the vocals',
        'make the bass track louder',
        'delete the drums and create nothing',
    ])('refuses a request that edits, refuses or names nothing to create: %s', (request) => {
        expect(hasHighLevelCreationEvidence(request)).toBe(false);
    });
});
