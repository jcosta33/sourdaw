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
        // The negation trails the verb, so it qualifies the object rather than refusing the request.
        'create a blues song without vocals',
        'make a beat with no hi-hats',
        // An instruction about existing tracks, then a genuine creation: the second clause carries it.
        'make sure the drums are loud, then create a bass track',
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
        // Each opens on an unqualified verb and takes it back before the verb that names the object.
        'make sure you never create a track',
        'make sure you do not create any new tracks',
        'please make sure not to create a new session',
        "I want you to make sure you don't add a bass track",
    ])('refuses a request that edits, refuses or names nothing to create: %s', (request) => {
        expect(hasHighLevelCreationEvidence(request)).toBe(false);
    });
});
