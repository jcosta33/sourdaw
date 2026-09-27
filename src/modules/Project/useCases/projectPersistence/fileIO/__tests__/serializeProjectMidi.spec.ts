import { describe, it, expect } from 'vitest';

import { type MidiStoreState } from '#/modules/MIDI/stores';
import { midiStore } from '#/modules/MIDI/stores';
import { joinNotes } from '#/modules/MIDI/useCases';

import { hydrateProjectMidi } from '../hydrateProjectMidi';
import { serializeProjectMidi } from '../serializeProjectMidi';

describe('serializeProjectMidi', () => {
    it('keeps an absent recorded slide onset distinct from explicit minimum through save and join', () => {
        const recorded: MidiStoreState = {
            notesByClipId: {
                'clip-1': [
                    { id: 'preceding', pitch: 60, startBeat: 0, duration: 1, velocity: 100, slide: 100 },
                    {
                        id: 'recorded',
                        pitch: 60,
                        startBeat: 1,
                        duration: 1,
                        velocity: 100,
                        expression: { slide: [{ offsetBeats: 0.5, value: 100 }] },
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        midiStore.set(structuredClone(recorded));
        joinNotes('clip-1', ['preceding', 'recorded']);
        const beforeSave = midiStore.value?.notesByClipId['clip-1']?.[0]?.expression?.slide;
        expect(beforeSave).toEqual([
            { offsetBeats: 1, value: 64 },
            { offsetBeats: 1.5, value: 100 },
        ]);

        const saved = serializeProjectMidi(recorded);
        expect(saved.notesByClipId['clip-1']?.[1]).not.toHaveProperty('slide');
        const reopened = hydrateProjectMidi(saved);
        expect(reopened.notesByClipId['clip-1']?.[1]).not.toHaveProperty('slide');
        midiStore.set(reopened);
        joinNotes('clip-1', ['preceding', 'recorded']);
        expect(midiStore.value?.notesByClipId['clip-1']?.[0]?.expression?.slide).toEqual(beforeSave);

        const minimum = { ...recorded.notesByClipId['clip-1']![1]!, slide: 0 };
        expect(
            hydrateProjectMidi(serializeProjectMidi({ ...recorded, notesByClipId: { 'clip-1': [minimum] } }))
                .notesByClipId['clip-1']?.[0]?.slide
        ).toBe(0);
    });
    it('serializes notes, CC, and pitch-bend into the Project MIDI contract', () => {
        const midi: MidiStoreState = {
            probabilitySeed: 4_294_967_295,
            notesByClipId: {
                'clip-1': [
                    { id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 },
                    {
                        id: 'note-2',
                        pitch: 67,
                        startBeat: 1.5,
                        duration: 0.5,
                        velocity: 88,
                        probability: 42,
                        pressure: 7,
                        slide: 3,
                        pitchBend: -12,
                        pitchBendRangeSemitones: 2,
                        channel: 9,
                        articulation: 'accent',
                    },
                ],
            },
            ccByClipId: {
                'clip-1': [{ id: 'cc-x', controller: 1, value: 64, beat: 0, channel: 0 }],
            },
            pitchBendByClipId: {
                'clip-1': [{ id: 'pb-x', value: 8192, beat: 0, channel: 0 }],
            },
        };

        expect(serializeProjectMidi(midi)).toEqual({
            probabilitySeed: 4_294_967_295,
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'note-1',
                        pitch: 60,
                        startBeat: 0,
                        duration: 1,
                        velocity: 100,
                        probability: 100,
                        pressure: 0,
                        pitchBend: 0,
                    },
                    {
                        id: 'note-2',
                        pitch: 67,
                        startBeat: 1.5,
                        duration: 0.5,
                        velocity: 88,
                        probability: 42,
                        pressure: 7,
                        slide: 3,
                        pitchBend: -12,
                        // Per-note expression the save path used to drop. The bend
                        // range is what makes the recorded `pitchBend` mean
                        // anything: read back absent, the engine substitutes the
                        // MPE default of 48 and a bend recorded at 2 replays 24x
                        // too wide.
                        pitchBendRangeSemitones: 2,
                        channel: 9,
                        articulation: 'accent',
                    },
                ],
            },
            ccByClipId: {
                'clip-1': [{ beat: 0, controller: 1, value: 64, channel: 0 }],
            },
            pitchBendByClipId: {
                'clip-1': [{ beat: 0, value: 8192, channel: 0 }],
            },
        });
    });

    it('round-trips a recorded bend range through save and reopen', () => {
        // A note recorded from an MPE controller set to +/-2 semitones carries
        // that range. Dropped on save, the reader has nothing to read and the
        // engine substitutes the MPE default of 48 -- the same stored
        // `pitchBend` then sounds 24x wider, roughly two octaves off, on a
        // project the user only opened.
        const recorded: MidiStoreState = {
            probabilitySeed: 1,
            notesByClipId: {
                'clip-1': [
                    {
                        id: 'note-1',
                        pitch: 60,
                        startBeat: 0,
                        duration: 1,
                        velocity: 100,
                        pitchBend: -4096,
                        pitchBendRangeSemitones: 2,
                        channel: 3,
                        articulation: 'accent',
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        const reopened = hydrateProjectMidi(serializeProjectMidi(recorded));

        expect(reopened.notesByClipId['clip-1']?.[0]).toMatchObject({
            pitchBend: -4096,
            pitchBendRangeSemitones: 2,
            channel: 3,
            articulation: 'accent',
        });
    });

    it('round-trips a note with recorded pressure, slide and bend curves through save and reopen', () => {
        const note = {
            id: 'note-1',
            pitch: 60,
            startBeat: 2,
            duration: 2,
            velocity: 100,
            probability: 100,
            pressure: 10,
            slide: 40,
            pitchBend: 0,
            pitchBendRangeSemitones: 48,
            channel: 2,
            expression: {
                pressure: [
                    { offsetBeats: 1, value: 90 },
                    { offsetBeats: 1.8, value: 20 },
                ],
                slide: [{ offsetBeats: 1, value: 64 }],
                pitchBend: [
                    { offsetBeats: 0.5, value: 4096 },
                    { offsetBeats: 1.5, value: 0 },
                ],
            },
        };
        const recorded: MidiStoreState = {
            probabilitySeed: 1,
            notesByClipId: { 'clip-1': [note] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        const reopened = hydrateProjectMidi(serializeProjectMidi(recorded));

        expect(reopened.notesByClipId['clip-1']).toEqual([note]);
    });

    it('leaves a note that never carried the fields without them', () => {
        // Absence is what makes the engine fall back to its default, so a plain
        // note must not gain a fabricated range, channel or articulation.
        const plain: MidiStoreState = {
            probabilitySeed: 1,
            notesByClipId: {
                'clip-1': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        const saved = serializeProjectMidi(plain).notesByClipId['clip-1']?.[0];

        expect(saved && Object.hasOwn(saved, 'pitchBendRangeSemitones')).toBe(false);
        expect(saved && Object.hasOwn(saved, 'channel')).toBe(false);
        expect(saved && Object.hasOwn(saved, 'articulation')).toBe(false);
    });
});
