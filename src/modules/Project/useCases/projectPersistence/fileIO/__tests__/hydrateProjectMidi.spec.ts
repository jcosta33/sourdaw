import { describe, it, expect } from 'vitest';

import { type MidiStoreState } from '#/modules/MIDI/stores';
import { shouldPlayMidiEvent } from '#/modules/MIDI/useCases';

import { hydrateProjectMidi } from '../hydrateProjectMidi';
import { serializeProjectMidi } from '../serializeProjectMidi';

const midi: MidiStoreState = {
    probabilitySeed: 3_735_928_559,
    notesByClipId: {
        'clip-1': [{ id: 'note-1', pitch: 60, startBeat: 0, duration: 1, velocity: 100 }],
    },
    ccByClipId: {
        'clip-1': [{ id: 'cc-x', controller: 1, value: 64, beat: 0, channel: 0 }],
    },
    pitchBendByClipId: {
        'clip-1': [{ id: 'pb-x', value: 8192, beat: 0, channel: 0 }],
    },
};

describe('hydrateProjectMidi', () => {
    it('preserves the unsigned u32 probability seed across serialization and hydration', () => {
        const roundTripped = hydrateProjectMidi(serializeProjectMidi(midi));

        expect(roundTripped.probabilitySeed).toBe(3_735_928_559);
    });

    it('preserves the fixed probability tuple corpus across save and hydration', () => {
        const corpusMidi: MidiStoreState = {
            probabilitySeed: 0xdecafbad,
            notesByClipId: {
                'clip-1': [
                    { id: 'event-alpha', pitch: 60, startBeat: 1, duration: 0.25, velocity: 100, probability: 50 },
                    { id: 'event-beta', pitch: 61, startBeat: 1, duration: 0.25, velocity: 100, probability: 50 },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };

        const hydrated = hydrateProjectMidi(serializeProjectMidi(corpusMidi));
        const acceptedIds = hydrated.notesByClipId['clip-1']
            ?.filter((note) =>
                shouldPlayMidiEvent({
                    projectProbabilitySeed: hydrated.probabilitySeed ?? 0,
                    clipId: 'clip-1',
                    eventId: note.id,
                    absoluteOccurrenceIndex: 0,
                    probabilityPercent: note.probability ?? 100,
                })
            )
            .map((note) => note.id);

        expect(acceptedIds).toEqual(['event-alpha']);
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
