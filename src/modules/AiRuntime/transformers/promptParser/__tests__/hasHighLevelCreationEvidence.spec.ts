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
        // A determiner introduces the object, so each of these asks for one that does not exist yet.
        'make a beat',
        'create a lo-fi beat',
        'add a bass track',
        'add another loop',
        'write a chord progression',
        'add a bass line',
    ])('reads a request for something new as creation evidence: %s', (request) => {
        expect(hasHighLevelCreationEvidence(request)).toBe(true);
    });

    it('treats a genre word as creation evidence even when the clause edits a named track', () => {
        // Deliberate: a request that reaches for a genre is describing music to be written, and the
        // route it opens still admits only commands confined to objects the batch itself creates.
        expect(hasHighLevelCreationEvidence('add reverb to the jazz track')).toBe(true);
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
        "you can't create a new track",
        "you shouldn't add a new track, reuse the drum bus",
    ])('refuses a request that edits, refuses or names nothing to create: %s', (request) => {
        expect(hasHighLevelCreationEvidence(request)).toBe(false);
    });

    it.each([
        'add automation to the beat',
        'add a delay to the loop',
        'add an eq to the bassline',
        'add some swing to the groove',
        'add 4 bars to the loop',
        'add a little more bass',
        'can you add a fade in to the loop',
        'make the loop 8 bars',
        'make the beat harder',
        // Bare `drums` names the kit already in the project as readily as one to be created.
        'add some drums',
    ])('refuses a mixing or editing request that names an object the project already holds: %s', (request) => {
        expect(hasHighLevelCreationEvidence(request)).toBe(false);
    });
});
