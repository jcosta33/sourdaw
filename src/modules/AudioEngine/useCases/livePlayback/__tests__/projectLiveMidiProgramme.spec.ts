/**
 * What the native engine is told to play as notes (#3892).
 *
 * The failure mode is the audio producer's, one command over: a note that never
 * becomes a `schedule-midi` entry is an instrument playing less than the part,
 * and nothing anywhere reports it. So every case asserts an event's presence,
 * its placement, or the one reason it is absent.
 *
 * The clock and the groove projector are flat stand-ins rather than the
 * composition root's, because the producer takes both as arguments precisely so
 * that this file can drive them; that the two paths agree on the real ones is
 * the offline parity suite's question, not this one's.
 *
 * `shouldPlayMidiEvent` is the real one. The chance roll is the single decision
 * this producer makes that the engine could also have made, and doubling it
 * would leave the divergence it exists to prevent unmeasured.
 */

import { describe, expect, it } from 'vitest';

import { type Device, type Track } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';
import { shouldPlayMidiEvent } from '#/modules/MIDI/useCases';

import {
    type OfflineMidiEventProjector,
    type OfflineChordPitchProjector,
} from '../../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { GENERATIVE_MIDI_EXCLUSION_REASON } from '../nativeMidiNoteSink';
import { projectLiveMidiProgramme, type LiveMidiProgrammeInput } from '../projectLiveMidiProgramme';

const SAMPLE_RATE = 48_000;
const FRAME = 1 / SAMPLE_RATE;
const TEMPO = 120;
const SECONDS_PER_BEAT = 60 / TEMPO;
const PROBABILITY_SEED = 0xdecafbad;

/** Flat tempo on the sample grid, as the real projector rounds. */
const projectPpqEndpoints: OfflinePpqEndpointProjector = ({ startPpq, endPpq, sampleRate }) => {
    const startSamples = Math.round(startPpq * SECONDS_PER_BEAT * sampleRate);
    const endSamples = Math.round(endPpq * SECONDS_PER_BEAT * sampleRate);
    return {
        startSamples,
        endSamples,
        durationSamples: endSamples - startSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: (endSamples - startSamples) / sampleRate,
    };
};

/**
 * The identity groove: notes come back where the clip put them, shifted by the
 * iteration the expansion is on. The groove and offset laws themselves belong
 * to the offline projector, which this producer shares rather than restates.
 */
const projectMidiEvents: OfflineMidiEventProjector = (input) => {
    if (input.phase === 'sequencer-groove') {
        return input.events;
    }
    const shift = input.iterationStartBeat - input.clipStartBeat;
    return input.events.map((event) => ({ ...event, startBeat: event.startBeat + input.clipStartBeat + shift }));
};

function seconds(beat: number): number {
    return Math.round(beat * SECONDS_PER_BEAT * SAMPLE_RATE) / SAMPLE_RATE;
}

function createDevice(overrides: Partial<Device> & { id: string }): Device {
    return { name: overrides.id, type: 'builtin-filter', bypassed: false, parameterValues: {}, ...overrides };
}

function instrument(id: string, instanceId: string): Device {
    return createDevice({ id, name: 'Harness Tone', type: 'external-plugin', externalInstanceId: instanceId });
}

function createTrack(overrides: Partial<Track> & { id: string }): Track {
    return {
        name: `name-${overrides.id}`,
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    };
}

function midiClip(
    overrides: Partial<Track['clips'][number]> & { id: string; trackId: string }
): Track['clips'][number] {
    return {
        name: overrides.id,
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#00ff00',
        locked: false,
        muted: false,
        ...overrides,
    };
}

/** The note shape the producer reads, taken from the store's own contract. */
type MidiNote = MidiStoreState['notesByClipId'][string][number];

function note(overrides: Partial<MidiNote> & { id: string }): MidiNote {
    return { pitch: 60, startBeat: 0, duration: 1, velocity: 100, ...overrides };
}

function projectProgramme(
    overrides: Partial<LiveMidiProgrammeInput> & { stripTracks: readonly Track[] }
): ReturnType<typeof projectLiveMidiProgramme> {
    return projectLiveMidiProgramme({
        attachedInstanceIds: new Set(['i1']),
        bakedStripIds: new Set(),
        notesByClipId: {},
        probabilitySeed: PROBABILITY_SEED,
        defaultTempo: TEMPO,
        sampleRate: SAMPLE_RATE,
        changes: [],
        projectPpqEndpoints,
        projectMidiEvents,
        selectProbability: shouldPlayMidiEvent,
        projectChordPitch: null,
        span: { startSeconds: 0, endSeconds: 8 },
        ...overrides,
    });
}

/** A MIDI strip whose instrument the engine already holds. */
function voicedTrack(clips: Track['clips']): Track {
    return createTrack({ id: 'midi-1', devices: [instrument('d1', 'i1')], clips });
}

describe('projectLiveMidiProgramme', () => {
    it('addresses a voiced strip’s notes to its attached instrument as on/off pairs', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [voicedTrack([clip])],
            notesByClipId: {
                'clip-1': [note({ id: 'n1', pitch: 64, startBeat: 1, duration: 2, velocity: 90 })],
            },
        });

        expect(programme.nativeVoicedStripIds).toEqual(new Set(['midi-1']));
        expect(programme.targets).toEqual([
            {
                target: { trackId: 'midi-1', deviceId: 'd1' },
                events: [
                    { time: seconds(1), note: 64, velocity: 90, channel: 0, isNoteOn: true },
                    { time: seconds(3), note: 64, velocity: 0, channel: 0, isNoteOn: false },
                ],
            },
        ]);
    });

    // The engine's sounding set is one bit per (channel, note), so the later
    // note-on would have nothing to release and the earlier note-off would
    // release the key the second note is holding.
    it('ends a note one frame before the next note at the same key begins', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [voicedTrack([clip])],
            notesByClipId: {
                'clip-1': [
                    note({ id: 'n1', pitch: 48, startBeat: 0, duration: 4 }),
                    note({ id: 'n2', pitch: 48, startBeat: 2, duration: 4 }),
                ],
            },
            span: { startSeconds: 0, endSeconds: 8 },
        });

        const events = programme.targets[0]?.events ?? [];
        expect(events.map((event) => [event.time, event.isNoteOn])).toEqual([
            [seconds(0), true],
            [seconds(2) - FRAME, false],
            [seconds(2), true],
            [seconds(6), false],
        ]);
    });

    // A note the earlier one is entirely inside has no sounding stretch left to
    // be trimmed to, and one ending at or before its own start is not a note.
    it('drops a note the following one at the same key covers entirely', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [voicedTrack([clip])],
            notesByClipId: {
                'clip-1': [
                    note({ id: 'n1', pitch: 48, startBeat: 1, duration: 2 }),
                    note({ id: 'n2', pitch: 48, startBeat: 1, duration: 4 }),
                ],
            },
        });

        const events = programme.targets[0]?.events ?? [];
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ time: seconds(1), note: 48, velocity: 100, channel: 0, isNoteOn: true });
    });

    // The roll is decided here rather than sent as odds, so that a chance note
    // the browser drops is the same note the engine drops. The oracle is the
    // shared selector itself, read at the seed and occurrence this pass uses.
    it('emits only the chance notes the shared roll admits, and sends no probability', () => {
        const chance = (eventId: string) =>
            shouldPlayMidiEvent({
                projectProbabilitySeed: PROBABILITY_SEED,
                clipId: 'clip-1',
                eventId,
                absoluteOccurrenceIndex: 0,
                probabilityPercent: 50,
            });
        // A seed the two outcomes actually differ under; a pair that rolled the
        // same way would leave the filter unmeasured.
        expect(chance('event-alpha')).not.toBe(chance('event-beta'));

        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [voicedTrack([clip])],
            notesByClipId: {
                'clip-1': [
                    note({ id: 'event-alpha', pitch: 60, startBeat: 0, probability: 50 }),
                    note({ id: 'event-beta', pitch: 62, startBeat: 1, probability: 50 }),
                ],
            },
        });

        const events = programme.targets[0]?.events ?? [];
        const admitted = chance('event-alpha') ? 60 : 62;
        expect(events.filter((event) => event.isNoteOn).map((event) => event.note)).toEqual([admitted]);
        expect(events.every((event) => event.probability === undefined)).toBe(true);
    });

    // A generative strip produces its notes on the Web Audio path, so it has no
    // native route at all — and unlike a strip with no instrument, it is one a
    // musician can see a plugin on and would otherwise never hear.
    it('excludes a generative strip by name rather than passing over it', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'midi-1',
                    devices: [instrument('d1', 'i1'), createDevice({ id: 'd2', type: 'yeast' })],
                    clips: [clip],
                }),
            ],
            notesByClipId: { 'clip-1': [note({ id: 'n1' })] },
        });

        expect(programme.targets).toEqual([]);
        expect(programme.nativeVoicedStripIds).toEqual(new Set());
        expect(programme.exclusions).toEqual([{ stripId: 'midi-1', reason: GENERATIVE_MIDI_EXCLUSION_REASON }]);
    });

    // The chord track is the arrangement's harmony, and the engine takes a
    // pitch rather than a degree: a strip that follows it must be conformed on
    // this side or it plays the wrong key.
    it('conforms a following strip’s pitches through the chord projector', () => {
        const projectChordPitch: OfflineChordPitchProjector = ({ pitch }) => pitch + 3;
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const track = createTrack({
            id: 'midi-1',
            devices: [instrument('d1', 'i1')],
            clips: [clip],
            followChordTrack: true,
        });
        const programme = projectProgramme({
            stripTracks: [track],
            notesByClipId: { 'clip-1': [note({ id: 'n1', pitch: 60 })] },
            projectChordPitch,
        });

        expect((programme.targets[0]?.events ?? [])[0]?.note).toBe(63);
    });

    // A note is admitted by its note-on alone. A release the span dropped would
    // leave the key sounding until the engine's own stop released it.
    it('carries a note’s release past the end of the span that admitted it', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [voicedTrack([clip])],
            notesByClipId: { 'clip-1': [note({ id: 'n1', startBeat: 1, duration: 4 })] },
            span: { startSeconds: 0, endSeconds: seconds(2) },
        });

        const events = programme.targets[0]?.events ?? [];
        expect(events.map((event) => event.time)).toEqual([seconds(1), seconds(5)]);
    });
});
