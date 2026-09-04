import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADD_NOTES_MAX_NOTES_PER_COMMAND, MIDI_TRANSFORM_MAX_NOTES } from '#/utils/midiNoteBatchLimits';

import { type MaterializedMidiNote, type MidiTransformImplementation } from '../../models/MidiTransform';
import { clearMidiTransformRegistry, registerMidiTransforms } from '../../stores/midiTransformRegistry';
import { expandMidiTransform } from '../expandMidiTransform';

/**
 * A stand-in generator whose only job is to be a function of its arguments: the seed decides the
 * pitches, so two expansions of the same request are comparable and a changed seed is visible.
 */
function seededNotes(count: number): MidiTransformImplementation {
    return (transformArguments) => {
        const seed = transformArguments.seed as number;
        return Array.from({ length: count }, (_unused, index) => ({
            pitch: 48 + ((seed + index) % 24),
            startBeat: Math.floor(index / 5),
            duration: 1,
            velocity: 90,
        }));
    };
}

function registerTransforms(overrides: Partial<Record<string, MidiTransformImplementation>> = {}): void {
    registerMidiTransforms({
        chordProgression: overrides.chordProgression ?? seededNotes(8),
        drumPattern: overrides.drumPattern ?? seededNotes(8),
        melody: overrides.melody ?? seededNotes(8),
    });
}

function expand(transformArguments: Record<string, unknown>, clipSpanBeats = 64) {
    return expandMidiTransform({ name: 'chordProgression', arguments: transformArguments, clipSpanBeats });
}

function allNotes(commands: readonly { notes: readonly MaterializedMidiNote[] }[]): MaterializedMidiNote[] {
    return commands.flatMap((command) => [...command.notes]);
}

describe('expandMidiTransform', () => {
    beforeEach(() => {
        clearMidiTransformRegistry();
    });

    afterEach(() => {
        clearMidiTransformRegistry();
    });

    it('expands the same arguments and seed into identical commands', () => {
        registerTransforms();

        const first = expand({ clipId: 'clip-a', bars: 4, seed: 7 });
        const second = expand({ clipId: 'clip-a', bars: 4, seed: 7 });

        expect(first).toEqual(second);
        expect(first).toMatchObject({ commands: [{ clipId: 'clip-a' }] });
    });

    it('produces different notes for a different seed', () => {
        registerTransforms();

        const first = expand({ clipId: 'clip-a', bars: 4, seed: 7 });
        const second = expand({ clipId: 'clip-a', bars: 4, seed: 8 });

        if (!('commands' in first) || !('commands' in second)) {
            throw new Error('both expansions must be accepted');
        }
        expect(allNotes(second.commands)).not.toEqual(allNotes(first.commands));
    });

    it('applies the declared seed default when the caller omits the seed', () => {
        registerTransforms();

        expect(expand({ clipId: 'clip-a', bars: 4 })).toEqual(expand({ clipId: 'clip-a', bars: 4, seed: 1 }));
    });

    it('refuses a transform whose bars do not fit the clip, naming both spans', () => {
        registerTransforms();

        expect(expand({ clipId: 'clip-a', bars: 12, seed: 3 }, 32)).toEqual({
            rejectionReason: 'MIDI transform chordProgression spans 48 beats but its clip spans 32 beats.',
        });
    });

    it('turns a throwing implementation into a rejection that names the transform', () => {
        registerTransforms({
            chordProgression: () => {
                throw new Error('style is outside the generator vocabulary');
            },
        });

        expect(() => expand({ clipId: 'clip-a', bars: 4, seed: 3 })).not.toThrow();
        expect(expand({ clipId: 'clip-a', bars: 4, seed: 3 })).toEqual({
            rejectionReason:
                'MIDI transform chordProgression could not generate notes: style is outside the generator vocabulary',
        });
    });

    it('chunks a wide transform into bounded addNotes commands in start-beat order', () => {
        registerTransforms({ chordProgression: seededNotes(300) });

        const expansion = expand({ clipId: 'clip-a', bars: 16, seed: 5 });

        if (!('commands' in expansion)) {
            throw new Error(`expected an accepted expansion, got: ${expansion.rejectionReason}`);
        }
        expect(expansion.commands.map((command) => command.notes.length)).toEqual([
            ADD_NOTES_MAX_NOTES_PER_COMMAND,
            ADD_NOTES_MAX_NOTES_PER_COMMAND,
            300 - 2 * ADD_NOTES_MAX_NOTES_PER_COMMAND,
        ]);
        expect(expansion.commands.every((command) => command.clipId === 'clip-a')).toBe(true);
        const startBeats = allNotes(expansion.commands).map((note) => note.startBeat);
        expect(startBeats).toEqual([...startBeats].sort((left, right) => left - right));
    });

    it('refuses a note the generator placed past the end of the clip', () => {
        registerTransforms({
            chordProgression: () => [{ pitch: 60, startBeat: 15, duration: 2, velocity: 90 }],
        });

        expect(expand({ clipId: 'clip-a', bars: 4, seed: 2 }, 16)).toEqual({
            rejectionReason:
                'MIDI transform chordProgression produced a note (pitch 60 at beat 15) outside its 16-beat clip.',
        });
    });

    it('refuses an argument the descriptor does not declare', () => {
        registerTransforms();

        expect(expand({ clipId: 'clip-a', bars: 4, seed: 2, tempo: 120 })).toEqual({
            rejectionReason: 'MIDI transform chordProgression does not accept the argument tempo.',
        });
    });

    it('refuses a transform name nothing registered', () => {
        registerTransforms();

        expect(
            expandMidiTransform({ name: 'arpeggiate', arguments: { clipId: 'clip-a', bars: 4 }, clipSpanBeats: 64 })
        ).toEqual({ rejectionReason: 'arpeggiate is not a registered MIDI transform.' });
    });

    it('sorts notes a generator emitted out of start-beat order across every chunk', () => {
        const count = 2 * ADD_NOTES_MAX_NOTES_PER_COMMAND + 44;
        registerTransforms({
            chordProgression: () =>
                Array.from({ length: count }, (_unused, index) => ({
                    pitch: 60,
                    startBeat: (count - 1 - index) * 0.25,
                    duration: 0.25,
                    velocity: 90,
                })),
        });

        const expansion = expand({ clipId: 'clip-a', bars: 16, seed: 5 }, 128);

        if (!('commands' in expansion)) {
            throw new Error(`expected an accepted expansion, got: ${expansion.rejectionReason}`);
        }
        expect(expansion.commands).toHaveLength(3);
        const startBeats = allNotes(expansion.commands).map((note) => note.startBeat);
        expect(startBeats).toEqual(Array.from({ length: count }, (_unused, index) => index * 0.25));
        const firstChunkStartBeats = expansion.commands[0]!.notes.map((note) => note.startBeat);
        expect(Math.max(...firstChunkStartBeats)).toBeLessThan(
            Math.min(...expansion.commands[1]!.notes.map((note) => note.startBeat))
        );
    });

    it('refuses a generator that produced more notes than a transform may write', () => {
        registerTransforms({ chordProgression: seededNotes(MIDI_TRANSFORM_MAX_NOTES + 1) });

        expect(expand({ clipId: 'clip-a', bars: 16, seed: 5 }, 256)).toEqual({
            rejectionReason: `MIDI transform chordProgression produced ${String(MIDI_TRANSFORM_MAX_NOTES + 1)} notes, more than the ${String(MIDI_TRANSFORM_MAX_NOTES)} a transform may write.`,
        });
    });

    it('accepts a generator that produced exactly the notes a transform may write', () => {
        registerTransforms({ chordProgression: seededNotes(MIDI_TRANSFORM_MAX_NOTES) });

        const expansion = expand({ clipId: 'clip-a', bars: 16, seed: 5 }, 256);

        if (!('commands' in expansion)) {
            throw new Error(`expected an accepted expansion, got: ${expansion.rejectionReason}`);
        }
        expect(expansion.commands.map((command) => command.notes.length)).toEqual(
            Array.from(
                { length: MIDI_TRANSFORM_MAX_NOTES / ADD_NOTES_MAX_NOTES_PER_COMMAND },
                () => ADD_NOTES_MAX_NOTES_PER_COMMAND
            )
        );
    });

    it('refuses an unbounded undeclared argument name without quoting it back', () => {
        registerTransforms();
        const hostileKey = 'k'.repeat(1000);

        const expansion = expand({ clipId: 'clip-a', bars: 4, seed: 2, [hostileKey]: 1 });

        expect(expansion).toEqual({
            rejectionReason: 'MIDI transform chordProgression does not accept an undeclared argument.',
        });
        expect(JSON.stringify(expansion)).not.toContain(hostileKey);
    });
});
