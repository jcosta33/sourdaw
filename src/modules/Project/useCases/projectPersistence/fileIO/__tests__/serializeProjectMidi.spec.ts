import { describe, it, expect } from 'vitest';

import { type MidiStoreState } from '#/modules/MIDI/stores';

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
                        channel: 9,
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
});
