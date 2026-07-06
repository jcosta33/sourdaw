import { describe, it, expect } from 'vitest';

import { type MidiStoreState } from '#/modules/MIDI/stores';

import { hydrateProjectMidi } from '../hydrateProjectMidi';
import { serializeProjectMidi } from '../serializeProjectMidi';

const midi: MidiStoreState = {
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

describe('midiStateMapping round-trip', () => {
    it('serializes notes, CC, and pitch-bend into the Project MIDI contract', () => {
        const serialized = serializeProjectMidi(midi);

        expect(serialized).toEqual({
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

    it('serializes and re-hydrates notes with their data intact', () => {
        const roundTripped = hydrateProjectMidi(serializeProjectMidi(midi));
        const note = roundTripped.notesByClipId['clip-1']?.[0];

        expect(note?.id).toBe('note-1');
        expect(note?.pitch).toBe(60);
        expect(note?.velocity).toBe(100);
    });

    it('preserves CC controller/value/beat/channel across the round-trip', () => {
        const roundTripped = hydrateProjectMidi(serializeProjectMidi(midi));
        const cc = roundTripped.ccByClipId['clip-1']?.[0];

        expect(cc?.controller).toBe(1);
        expect(cc?.value).toBe(64);
        expect(cc?.beat).toBe(0);
        expect(cc?.channel).toBe(0);
    });

    it('preserves pitch-bend value/beat/channel across the round-trip', () => {
        const roundTripped = hydrateProjectMidi(serializeProjectMidi(midi));
        const pb = roundTripped.pitchBendByClipId['clip-1']?.[0];

        expect(pb?.value).toBe(8192);
        expect(pb?.beat).toBe(0);
        expect(pb?.channel).toBe(0);
    });

    it('mints deterministic CC/pitch-bend ids so re-imports are stable', () => {
        const first = hydrateProjectMidi(serializeProjectMidi(midi));
        const second = hydrateProjectMidi(serializeProjectMidi(midi));

        expect(first.ccByClipId['clip-1']?.[0]?.id).toBe(second.ccByClipId['clip-1']?.[0]?.id);
        expect(first.ccByClipId['clip-1']?.[0]?.id).toBe('cc-clip-1-0');
        expect(first.pitchBendByClipId['clip-1']?.[0]?.id).toBe('pb-clip-1-0');
    });

    it('returns empty maps for empty input without throwing', () => {
        const empty = hydrateProjectMidi({ notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} });
        expect(empty.notesByClipId).toEqual({});
        expect(empty.ccByClipId).toEqual({});
        expect(empty.pitchBendByClipId).toEqual({});
    });
});
