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
        // A whole work stands behind the determiner like anything else a project can hold.
        'write a song',
        'set up a new project',
        // Nouns a mixing request reaches for just as often, and the determiner is what separates them.
        'add some drums',
        'lay down some chords',
        // A preposition further along does not reach back: these still introduce their object.
        'create a song for a friend',
        'add some chords under the melody',
        'add a bass track to the session',
        // A quantifier reaches its noun through a preposition; the phrase still introduces it.
        'create a track of drums',
        'create a couple of tracks',
        'add a bunch of drums',
        'make a set of chords',
        // 'with' names what a piece starts from, not a destination inside one.
        'start with a drum track',
        'begin with a new session',
        // The shortest reading of the phrase decides: a referring word further along belongs to the
        // next clause, and swallowing it would discard an introduction the request plainly makes.
        'write a melody the chords follow',
        'make a beat these drums sit on',
        // Plural forms of introduced objects.
        'add some loops',
        'write some melodies',
        'create a few grooves',
        'make some riffs',
        'lay down some progressions',
        // A non-numeric determiner on "beats" still introduces a plural object; only a numeric
        // determiner naming a beat count reads as a duration instead.
        'add some beats',
    ])('reads a request for something new as creation evidence: %s', (request) => {
        expect(hasHighLevelCreationEvidence(request)).toBe(true);
    });

    it('reads a determiner on the verb own object as creation, which is accepted looseness', () => {
        // "make some tracks louder" is an edit, and separating it from "make some tracks" would cost
        // the plain creation requests this gate exists for. The evidence opens a route that admits
        // only commands confined to objects the same batch creates, so the false positive buys no
        // authority over anything that already exists.
        expect(hasHighLevelCreationEvidence('make some tracks louder')).toBe(true);
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
        // A request reaches for a song it already has as readily as for one it wants written, so the
        // word alone decides nothing; without a determiner these all point at what the project holds.
        'add reverb to the song',
        'make the session louder',
        'build out the arrangement',
        // A partitive gap ending in "of" paired with an identifier tail names an existing object by
        // kind and identifier: these duplicate or bounce it rather than create something new.
        'make a copy of track 3',
        'make a duplicate of clip 4',
        'produce a bounce of track 2',
        'make a stem of track 5',
        // The identifier tail also reads a hash-prefixed number, a single capital letter, or a
        // spelled-out number one through ten.
        'make a copy of track #3',
        'make a copy of clip A',
        'make a copy of track three',
        // False for an unrelated reason: the gap "copy of the " is three words, past the two-word
        // cap INTRODUCED_OBJECT_PATTERN allows, so the pattern never matches here at all.
        'make a copy of the drums',
        // A numeric determiner immediately before "beat(s)" names a duration, not an object: the
        // whole match reads as a measure rather than something to create.
        'make the intro 8 beats longer',
        'make the loop 4 beats long',
        'start the fill 2 beats early',
        'make it 4 beats longer',
        'make each note 2 beats long',
        'make the drums 2 beats later',
        'make it 1 beat longer',
    ])('refuses a mixing or editing request that names an object the project already holds: %s', (request) => {
        expect(hasHighLevelCreationEvidence(request)).toBe(false);
    });

    it.each([
        'add reverb to a few tracks',
        'add an eq to a couple of tracks',
        'add a plugin to some tracks',
        'add a send on some tracks',
    ])('refuses an edit whose preposition makes the phrase its destination: %s', (request) => {
        // Every gap here is clean, so the preceding preposition is the only thing refusing them.
        expect(hasHighLevelCreationEvidence(request)).toBe(false);
    });

    it.each([
        'make some of the tracks louder',
        'make some of the clips shorter',
        'make some of my tracks louder',
        'make some of these clips shorter',
    ])('refuses an edit that reaches its object through a referring word: %s', (request) => {
        // No preposition precedes the determiner in any of these; the article, possessive or
        // demonstrative inside the phrase is what names objects the project already holds.
        expect(hasHighLevelCreationEvidence(request)).toBe(false);
    });
});
