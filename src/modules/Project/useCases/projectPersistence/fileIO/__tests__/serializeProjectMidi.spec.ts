import { describe, it, expect } from 'vitest';

import { type MidiStoreState } from '#/modules/MIDI/stores';

import { hydrateProjectMidi } from '../hydrateProjectMidi';
import { serializeProjectMidi } from '../serializeProjectMidi';

describe('serializeProjectMidi', () => {
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
                        slide: 0,
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
