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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, type Device, type Track } from '#/modules/Arrangement/stores';
import {
    setTimeOperationDependencies,
    stageRecordingTake,
    startRecording,
    stopRecording,
} from '#/modules/Arrangement/useCases';
import {
    isValidAutomationTimeStateRestorePlan,
    prepareAutomationTimeOperation,
    prepareAutomationTimeStateRestore,
} from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import {
    createGrooveMidiEventProjector,
    isValidMidiTimeStateRestorePlan,
    prepareMidiGlobalTimeTransaction,
    prepareMidiTimeStateRestore,
    resolveMidiNoteArticulationId,
    shouldPlayMidiEvent,
} from '#/modules/MIDI/useCases';
import { defaultTransportState, playheadWrapCountRef, transportStore } from '#/modules/Transport/stores';
import {
    isValidTimelineMapStateRestorePlan,
    prepareTimelineMapStateRestore,
    prepareTimelineMapTimeOperation,
} from '#/modules/Transport/useCases';
import { type AppAction } from '#/utils/handlerContract';

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
        carriedStripIds: new Set(overrides.stripTracks.map((track) => track.id)),
        notesByClipId: {},
        probabilitySeed: PROBABILITY_SEED,
        defaultTempo: TEMPO,
        sampleRate: SAMPLE_RATE,
        changes: [],
        projectPpqEndpoints,
        projectMidiEvents,
        selectProbability: shouldPlayMidiEvent,
        projectChordPitch: null,
        resolveArticulationId: null,
        span: { startSeconds: 0, endSeconds: 8 },
        ...overrides,
    });
}

/** A MIDI strip whose instrument the engine already holds. */
function voicedTrack(clips: Track['clips']): Track {
    return createTrack({ id: 'midi-1', devices: [instrument('d1', 'i1')], clips });
}

/**
 * A MIDI strip carrying the one built-in with a per-note articulation surface.
 *
 * The device type is what decides an articulation here, so the same clip note
 * on `voicedTrack` above is the control case: it carries an articulation name
 * the resolver answers nothing for.
 */
function levainTrack(clips: Track['clips']): Track {
    return createTrack({ id: 'midi-1', devices: [createDevice({ id: 'd1', name: 'Levain', type: 'levain' })], clips });
}

describe('projectLiveMidiProgramme', () => {
    it('closes the open final pass on its recorded source phase and emits only that pass after comp selection', async () => {
        const trackId = 'track-midi';
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('MIDI final-pass playback');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [createTrack({ id: trackId, armed: true })],
            selectedTrackId: trackId,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        try {
            transportStore.set({
                ...defaultTransportState,
                isLooping: true,
                loopStart: 8,
                loopEnd: 12,
                playheadPosition: 8,
            });
            const [clip] = startRecording(8);
            if (!clip) {
                throw new Error('Expected a provisional MIDI recording');
            }
            for (const pass of [0, 1] as const) {
                stageRecordingTake({
                    trackId,
                    clipId: clip.id,
                    name: `Completed pass ${pass}`,
                    startBeat: 8,
                    endBeat: 12,
                    sourceOffsetBeats: pass * 4,
                    recordingPassIndex: pass,
                });
            }
            const open = takeLaneStore.value!.lanes[0]!.takes.find((take) => take.name === 'Take 1')!;
            expect(open).toMatchObject({ recordingPassIndex: 2, startBeat: 8 });
            expect(open).not.toHaveProperty('sourceOffsetBeats');

            transportStore.set({ ...transportStore.value!, isPlaying: true });
            playheadWrapCountRef.current = 2;
            await stopRecording(9.5);
            transportStore.set({ ...transportStore.value!, isPlaying: false });
            playheadWrapCountRef.current = 0;
            flushAutomergeStorageWrites();
            const final = takeLaneStore.value!.lanes[0]!.takes.find((take) => take.name === 'Take 1')!;
            expect(final).toMatchObject({ recordingPassIndex: 2, sourceOffsetBeats: 8, endBeat: 9.5 });
            // Recorded note rows use unwrapped media beats beyond the clip's visual loop span.
            midiStore.set({
                ...midiStore.value!,
                notesByClipId: {
                    ...midiStore.value!.notesByClipId,
                    [clip.id]: [
                        {
                            id: 'pass-0',
                            pitch: 60,
                            startBeat: 0.5,
                            duration: 0.25,
                            velocity: 100,
                            recordingPassIndex: 0,
                        },
                        {
                            id: 'pass-1',
                            pitch: 62,
                            startBeat: 4.5,
                            duration: 0.25,
                            velocity: 100,
                            recordingPassIndex: 1,
                        },
                        {
                            id: 'pass-2',
                            pitch: 64,
                            startBeat: 8.5,
                            duration: 0.25,
                            velocity: 100,
                            recordingPassIndex: 2,
                        },
                    ],
                },
            });
            await executeAppAction({
                type: 'setCompRegion',
                payload: { trackId, takeId: final.id, startBeat: 8, endBeat: final.endBeat },
            });
            flushAutomergeStorageWrites();
            const track = trackStore.value?.tracks[0];
            if (!track || !midiStore.value) {
                throw new Error('Expected a committed MIDI track and note store');
            }
            const sampleRate = 48_000;
            const projectPpqEndpoints = ({ startPpq, endPpq }: { startPpq: number; endPpq: number }) => {
                const startSamples = Math.round(startPpq * 0.5 * sampleRate);
                const endSamples = Math.round(endPpq * 0.5 * sampleRate);
                return {
                    startSamples,
                    endSamples,
                    durationSamples: endSamples - startSamples,
                    startSeconds: startSamples / sampleRate,
                    endSeconds: endSamples / sampleRate,
                    durationSeconds: (endSamples - startSamples) / sampleRate,
                };
            };
            const programme = projectLiveMidiProgramme({
                stripTracks: [
                    {
                        ...track,
                        devices: [
                            {
                                id: 'instrument',
                                name: 'Harness Tone',
                                type: 'external-plugin',
                                externalInstanceId: 'instance',
                                bypassed: false,
                                parameterValues: {},
                            },
                        ],
                    },
                ],
                attachedInstanceIds: new Set(['instance']),
                bakedStripIds: new Set(),
                carriedStripIds: new Set([trackId]),
                notesByClipId: midiStore.value.notesByClipId,
                probabilitySeed: midiStore.value.probabilitySeed,
                defaultTempo: 120,
                sampleRate,
                changes: [],
                projectPpqEndpoints,
                projectMidiEvents: createGrooveMidiEventProjector(),
                selectProbability: shouldPlayMidiEvent,
                projectChordPitch: null,
                resolveArticulationId: null,
                span: { startSeconds: 4, endSeconds: 6 },
            });
            expect(
                programme.targets.flatMap(({ events }) =>
                    events.filter((event) => event.isNoteOn).map((event) => event.note)
                )
            ).toEqual([64]);
        } finally {
            transportStore.set(defaultTransportState);
            playheadWrapCountRef.current = 0;
            clearUndoHistory();
            resetActionReplayAuthority();
            clearHandlerRegistry();
            trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
            takeLaneStore.set({ lanes: [] });
            flushAutomergeStorageWrites();
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
        }
    });

    it('sounds only selected frozen source rows on each original pass occurrence', () => {
        const before = takeLaneStore.value;
        // A looping comp restarts the take each loop length, as live does.
        const clip = midiClip({ id: 'original', trackId: 'midi-1', endBeat: 10, loopEnabled: true, loopLength: 4 });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-midi',
                    trackId: 'midi-1',
                    takes: [
                        {
                            id: 'selected',
                            clipId: 'original',
                            name: 'Selected',
                            startBeat: 0,
                            endBeat: 10,
                            selected: true,
                            sourceOffsetBeats: 5,
                            recordingPassIndex: 1,
                            midiSource: {
                                sourceClipId: 'original',
                                sourceEntryBeat: 5,
                                sourceEndBeat: 9,
                                phaseHeadBeat: 0,
                                passLengthBeats: 4,
                                rows: {
                                    notes: {
                                        present: true,
                                        value: [
                                            note({
                                                id: 'held-previous',
                                                pitch: 72,
                                                startBeat: 4.75,
                                                duration: 1,
                                                recordingPassIndex: 0,
                                            }),
                                            note({
                                                id: 'selected-row',
                                                pitch: 60,
                                                startBeat: 5.5,
                                                recordingPassIndex: 1,
                                            }),
                                        ],
                                    },
                                    controlChanges: { present: false, value: [] },
                                    pitchBends: { present: false, value: [] },
                                },
                            },
                        },
                    ],
                    activeCompRegions: [{ startBeat: 0, endBeat: 10, takeId: 'selected' }],
                },
            ],
        });
        try {
            const programme = projectProgramme({
                stripTracks: [voicedTrack([clip])],
                notesByClipId: { original: [note({ id: 'other-pass', pitch: 72, startBeat: 9.5 })] },
                projectMidiEvents: createGrooveMidiEventProjector(),
                span: { startSeconds: 0, endSeconds: 6 },
            });

            expect(
                programme.targets[0]?.events.filter((event) => event.isNoteOn).map((event) => [event.note, event.time])
            ).toEqual([
                [60, seconds(0.5)],
                [60, seconds(4.5)],
                [60, seconds(8.5)],
            ]);
        } finally {
            takeLaneStore.set(before ?? { lanes: [] });
        }
    });
    it('sounds a frozen first pass’s run-up under a comp that ends at the take start', () => {
        // Recorded from 6 in loop [8, 12): the first pass's take opens on the loop, its run-up before it.
        const before = takeLaneStore.value;
        const clip = midiClip({ id: 'original', trackId: 'midi-1', startBeat: 6, endBeat: 13 });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane-midi',
                    trackId: 'midi-1',
                    takes: [
                        {
                            id: 'first-pass',
                            clipId: 'original',
                            name: 'First pass',
                            startBeat: 8,
                            endBeat: 12,
                            selected: true,
                            sourceOffsetBeats: 0,
                            recordingPassIndex: 0,
                            midiSource: {
                                sourceClipId: 'original',
                                sourceEntryBeat: 2,
                                sourceEndBeat: 6,
                                phaseHeadBeat: 8,
                                passLengthBeats: 4,
                                rows: {
                                    notes: {
                                        present: true,
                                        value: [
                                            note({ id: 'run-up', pitch: 61, startBeat: 0.5, recordingPassIndex: 0 }),
                                            note({ id: 'in-loop', pitch: 62, startBeat: 3, recordingPassIndex: 0 }),
                                        ],
                                    },
                                    controlChanges: { present: false, value: [] },
                                    pitchBends: { present: false, value: [] },
                                },
                            },
                        },
                    ],
                    activeCompRegions: [{ startBeat: 6, endBeat: 8, takeId: 'first-pass' }],
                },
            ],
        });
        try {
            const programme = projectProgramme({
                stripTracks: [voicedTrack([clip])],
                notesByClipId: { original: [] },
                projectMidiEvents: createGrooveMidiEventProjector(),
                span: { startSeconds: 0, endSeconds: 7 },
            });

            expect(
                programme.targets[0]?.events.filter((event) => event.isNoteOn).map((event) => [event.note, event.time])
            ).toEqual([[61, seconds(6.5)]]);
        } finally {
            takeLaneStore.set(before ?? { lanes: [] });
        }
    });
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

    // The loop anchor's pass-through into the real projection (#5198): the
    // flat stand-in above never reads `loopOriginBeat`, so this case drives
    // the groove projector the composition root actually injects. The clip is
    // the state a born-looped clip (start 0, anchor 0, loop 4) carries after a
    // start trim to 4: head 4, anchor kept at 0 (advance 4), offset wrapped to
    // its phase 0, and the stored rows ridden by the wrap's −4 — the loop head
    // at −4 and one row of source material a beat past the region end at 0.5.
    it('carries the loop anchor to the real projection: the trimmed-in head sounds at its pass, the row past the region stays silent', () => {
        const clip = midiClip({
            id: 'clip-1',
            trackId: 'midi-1',
            startBeat: 4,
            endBeat: 12,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
            midiOffsetBeats: 0,
        });
        const programme = projectProgramme({
            stripTracks: [voicedTrack([clip])],
            projectMidiEvents: createGrooveMidiEventProjector(),
            notesByClipId: {
                'clip-1': [
                    note({ id: 'n-loop-head', pitch: 60, startBeat: -4, duration: 1 }),
                    note({ id: 'n-past-region', pitch: 72, startBeat: 0.5, duration: 0.25 }),
                ],
            },
        });

        // The anchored window [−4, 0) admits the head and the projection wraps
        // it onto the opening of every pass — beats 4 and 8 here; the row at
        // 0.5 reads outside that window and never sounds. The unanchored
        // [0, 4) reading admits the past-region row and drops the head, so
        // losing the pass-through swaps the audible material.
        expect(programme.targets[0]?.events).toEqual([
            { time: seconds(4), note: 60, velocity: 100, channel: 0, isNoteOn: true },
            { time: seconds(5), note: 60, velocity: 0, channel: 0, isNoteOn: false },
            { time: seconds(8), note: 60, velocity: 100, channel: 0, isNoteOn: true },
            { time: seconds(9), note: 60, velocity: 0, channel: 0, isNoteOn: false },
        ]);
    });

    it('strikes a Levain note on the articulation it carries, and releases it carrying none', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [levainTrack([clip])],
            resolveArticulationId: resolveMidiNoteArticulationId,
            notesByClipId: {
                'clip-1': [
                    note({
                        id: 'n1',
                        pitch: 64,
                        startBeat: 1,
                        duration: 2,
                        velocity: 90,
                        articulation: 'pizzicato',
                    }),
                ],
            },
        });

        expect(programme.targets).toEqual([
            {
                target: { trackId: 'midi-1', deviceId: 'd1' },
                events: [
                    // 10 is `pizzicato` in the project's own table, which the
                    // resolver here is the real reader of.
                    { time: seconds(1), note: 64, velocity: 90, channel: 0, isNoteOn: true, articulationId: 10 },
                    { time: seconds(3), note: 64, velocity: 0, channel: 0, isNoteOn: false },
                ],
            },
        ]);
        // A release addresses the key; nothing about it selects a sound.
        expect(programme.targets[0]?.events[1]).not.toHaveProperty('articulationId');
    });

    it('states no articulation for a Levain note naming none', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [levainTrack([clip])],
            resolveArticulationId: resolveMidiNoteArticulationId,
            notesByClipId: { 'clip-1': [note({ id: 'n1', pitch: 64, startBeat: 1, duration: 2 })] },
        });

        // Absence, not a default: articulation 0 is `sustain`, a sound of its
        // own, and a note naming none sounds on whatever the device stands on.
        expect(programme.targets[0]?.events[0]).not.toHaveProperty('articulationId');
    });

    it('states no articulation for the same note on an instrument that has none', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [voicedTrack([clip])],
            resolveArticulationId: resolveMidiNoteArticulationId,
            notesByClipId: {
                'clip-1': [
                    note({
                        id: 'n1',
                        pitch: 64,
                        startBeat: 1,
                        duration: 2,
                        articulation: 'pizzicato',
                    }),
                ],
            },
        });

        expect(programme.targets[0]?.events[0]).not.toHaveProperty('articulationId');
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

    /**
     * A pad is struck and decays on its own envelope, so a clip's release
     * chokes a sound the web carrier lets ring (`scheduleTrackClips.ts`
     * withholds it for the Toaster, and the live worklet posts `noteOn`
     * alone). With no key held there is nothing for two hits on one pad to
     * contend over either, so the overlap trim is skipped as well — both hits
     * sound, at their own on-times, neither dropped.
     *
     * The fixture is the overlap case above: the second note starts two beats
     * into the first, which a trimmed target would end one frame early, and
     * a target that emitted releases would answer with four events.
     */
    it('sends a drum-machine strip strikes alone, untrimmed, for overlapping hits on one pad', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const overlappingHits = {
            'clip-1': [
                note({ id: 'n1', pitch: 36, startBeat: 0, duration: 4 }),
                note({ id: 'n2', pitch: 36, startBeat: 2, duration: 4 }),
                // A same-frame double hit on the same pad: with no key to
                // contend over, both strikes at beat 0 must survive.
                note({ id: 'n3', pitch: 36, startBeat: 0, duration: 4 }),
            ],
        };
        const programme = projectProgramme({
            stripTracks: [
                createTrack({ id: 'midi-1', devices: [createDevice({ id: 'd1', type: 'toaster' })], clips: [clip] }),
            ],
            attachedInstanceIds: new Set(),
            notesByClipId: overlappingHits,
        });

        expect(programme.targets.map((entry) => entry.target)).toEqual([{ trackId: 'midi-1', deviceId: 'd1' }]);
        expect(programme.targets[0]?.events).toEqual([
            { time: seconds(0), note: 36, velocity: 100, channel: 0, isNoteOn: true },
            { time: seconds(0), note: 36, velocity: 100, channel: 0, isNoteOn: true },
            { time: seconds(2), note: 36, velocity: 100, channel: 0, isNoteOn: true },
        ]);
    });

    // The same overlapping pair on a keyboard body still gets the release and
    // the trim: it holds one key per (channel, note), so the second note-on
    // would have nothing to release and the first note-off would lift the key
    // the second is holding.
    it('still trims and releases the same overlapping notes on a keyboard body', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'midi-1',
                    devices: [createDevice({ id: 'd1', type: 'grand-boule' })],
                    clips: [clip],
                }),
            ],
            attachedInstanceIds: new Set(),
            notesByClipId: {
                'clip-1': [
                    note({ id: 'n1', pitch: 36, startBeat: 0, duration: 4 }),
                    note({ id: 'n2', pitch: 36, startBeat: 2, duration: 4 }),
                ],
            },
        });

        expect(programme.targets[0]?.events.map((event) => [event.time, event.isNoteOn])).toEqual([
            [seconds(0), true],
            [seconds(2) - FRAME, false],
            [seconds(2), true],
            [seconds(6), false],
        ]);
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

    // A MIDI strip's instrument sits at the head of its chain and anything
    // attached behind it is an effect, so the sink is the *first* attached
    // external device. Addressing the last would send the part to a reverb and
    // leave the instrument holding nothing.
    it('addresses the first attached external device on a chain that holds two', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'midi-1',
                    devices: [
                        instrument('d1', 'i1'),
                        createDevice({
                            id: 'd2',
                            name: 'Harness Reverb',
                            type: 'external-plugin',
                            externalInstanceId: 'i2',
                        }),
                    ],
                    clips: [clip],
                }),
            ],
            attachedInstanceIds: new Set(['i1', 'i2']),
            notesByClipId: { 'clip-1': [note({ id: 'n1' })] },
        });

        expect(programme.targets.map((entry) => entry.target)).toEqual([{ trackId: 'midi-1', deviceId: 'd1' }]);
    });

    // A built-in instrument holds a note store by type alone — it needs no
    // attach state the way a hosted plugin does, so an empty attach set still
    // addresses this strip's notes to it.
    it('addresses a MIDI strip’s notes to its built-in instrument with no attach state', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [
                createTrack({ id: 'midi-1', devices: [createDevice({ id: 'd1', type: 'fermenter' })], clips: [clip] }),
            ],
            attachedInstanceIds: new Set(),
            notesByClipId: { 'clip-1': [note({ id: 'n1' })] },
        });

        expect(programme.targets.map((entry) => entry.target)).toEqual([{ trackId: 'midi-1', deviceId: 'd1' }]);
    });

    // The sampler is the instrument a natively carried orchestral strip plays
    // through, and the engine registers its note store like any other built-in
    // instrument's: without notes addressed to it the strip carries natively
    // and sounds nothing at all.
    it('addresses a MIDI strip’s notes to its orchestral sampler', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [
                createTrack({ id: 'midi-1', devices: [createDevice({ id: 'd1', type: 'levain' })], clips: [clip] }),
            ],
            attachedInstanceIds: new Set(),
            notesByClipId: { 'clip-1': [note({ id: 'n1' })] },
        });

        expect(programme.targets.map((entry) => entry.target)).toEqual([{ trackId: 'midi-1', deviceId: 'd1' }]);
    });

    // Chain order picks the first sink across both kinds, hosted or built-in,
    // whichever the chain places first.
    it('takes the first note sink in chain order across hosted and built-in', () => {
        const clip1 = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const clip2 = midiClip({ id: 'clip-2', trackId: 'midi-2' });
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'midi-1',
                    devices: [instrument('d1', 'i1'), createDevice({ id: 'd2', type: 'fermenter' })],
                    clips: [clip1],
                }),
                createTrack({
                    id: 'midi-2',
                    devices: [createDevice({ id: 'd3', type: 'fermenter' }), instrument('d4', 'i2')],
                    clips: [clip2],
                }),
            ],
            attachedInstanceIds: new Set(['i1', 'i2']),
            notesByClipId: {
                'clip-1': [note({ id: 'n1' })],
                'clip-2': [note({ id: 'n2' })],
            },
        });

        expect(programme.targets.map((entry) => entry.target)).toEqual([
            { trackId: 'midi-1', deviceId: 'd1' },
            { trackId: 'midi-2', deviceId: 'd3' },
        ]);
    });

    // A built-in effect ahead of the instrument is passed over: it processes
    // an input and generates nothing on its own, so it is never a sink.
    it('passes over a built-in effect ahead of the instrument', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [
                createTrack({
                    id: 'midi-1',
                    devices: [createDevice({ id: 'd1', type: 'knead' }), createDevice({ id: 'd2', type: 'fermenter' })],
                    clips: [clip],
                }),
            ],
            attachedInstanceIds: new Set(),
            notesByClipId: { 'clip-1': [note({ id: 'n1' })] },
        });

        expect(programme.targets.map((entry) => entry.target)).toEqual([{ trackId: 'midi-1', deviceId: 'd2' }]);
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

    // A later carrier rule can leave a strip with a voiced built-in on Web
    // Audio all the same, and Web Audio already sounds that generator — so a
    // strip the batch did not build contributing gets no notes at all, however
    // voiced its sink would otherwise be.
    it('sends nothing to a voiced Fermenter strip the batch did not build contributing', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [
                createTrack({ id: 'midi-1', devices: [createDevice({ id: 'd1', type: 'fermenter' })], clips: [clip] }),
            ],
            attachedInstanceIds: new Set(),
            notesByClipId: { 'clip-1': [note({ id: 'n1' })] },
            carriedStripIds: new Set(),
        });

        expect(programme.targets).toEqual([]);
        expect(programme.nativeVoicedStripIds).toEqual(new Set());
        expect(programme.exclusions).toEqual([]);
    });

    // Same gate for a hosted instrument: the attach state alone says the engine
    // holds a body for it, not that this batch built the strip contributing.
    it('sends nothing to a voiced hosted-instrument strip the batch did not build contributing', () => {
        const clip = midiClip({ id: 'clip-1', trackId: 'midi-1' });
        const programme = projectProgramme({
            stripTracks: [voicedTrack([clip])],
            notesByClipId: { 'clip-1': [note({ id: 'n1' })] },
            carriedStripIds: new Set(),
        });

        expect(programme.targets).toEqual([]);
        expect(programme.nativeVoicedStripIds).toEqual(new Set());
        expect(programme.exclusions).toEqual([]);
    });
});

/**
 * A take a split or a Delete Time freezes plays what live comp playback played
 * for it before the edit, through the real production projection on both
 * sides: the live programme reads the unfrozen take's media before the edit
 * and the captured source after it, with the real groove projector and the
 * real chance roll.
 */
describe('projectLiveMidiProgramme for a take a split or Delete Time freezes, against live comp playback', () => {
    const trackId = 'track-midi';
    const rolls: { eventId: string; occurrence: number }[] = [];
    const recordingRoll: LiveMidiProgrammeInput['selectProbability'] = (input) => {
        rolls.push({ eventId: input.eventId, occurrence: input.absoluteOccurrenceIndex });
        return shouldPlayMidiEvent(input);
    };

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('MIDI frozen take parity');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        setTimeOperationDependencies({
            savedRestorePlanValidators: {
                automation: isValidAutomationTimeStateRestorePlan,
                midi: isValidMidiTimeStateRestorePlan,
                timelineMap: isValidTimelineMapStateRestorePlan,
            },
            prepareAutomationTimeOperation,
            prepareAutomationTimeStateRestore,
            prepareMidiGlobalTimeTransaction,
            prepareMidiTimeStateRestore,
            prepareTimelineMapTimeOperation,
            prepareTimelineMapStateRestore,
        });
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [createTrack({ id: trackId, armed: true })],
            selectedTrackId: trackId,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        rolls.length = 0;
    });

    afterEach(() => {
        transportStore.set(defaultTransportState);
        playheadWrapCountRef.current = 0;
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        setTimeOperationDependencies(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    async function dispatch(action: AppAction): Promise<void> {
        await executeAppAction(action);
        flushAutomergeStorageWrites();
    }

    function recordedClipId(): string {
        const clip = trackStore.value?.tracks[0]?.clips[0];
        if (!clip) {
            throw new Error('Expected the committed recording clip');
        }
        return clip.id;
    }

    function takeId(name: string): string {
        const take = takeLaneStore.value?.lanes[0]?.takes.find((candidate) => candidate.name === name);
        if (!take) {
            throw new Error(`Expected the ${name} take`);
        }
        return take.id;
    }

    /**
     * Loop [8, 12) recorded from `recordPointBeat`, its first pass staged as
     * the scheduler stages it and the recording stopped one wrap later at
     * `stopBeat`, so the open pass becomes Take 1. `rows` are written in media
     * beats from the record point.
     */
    async function recordLoop(recordPointBeat: number, stopBeat: number, rows: readonly MidiNote[]): Promise<void> {
        transportStore.set({
            ...defaultTransportState,
            isLooping: true,
            loopStart: 8,
            loopEnd: 12,
            playheadPosition: recordPointBeat,
        });
        const [clip] = startRecording(recordPointBeat);
        if (!clip) {
            throw new Error('Expected a provisional MIDI recording');
        }
        transportStore.set({ ...transportStore.value!, isPlaying: true, isRecording: true });
        stageRecordingTake({
            trackId,
            clipId: clip.id,
            name: 'Pass 0',
            startBeat: 8,
            endBeat: 12,
            sourceOffsetBeats: 8 - recordPointBeat,
            recordingPassIndex: 0,
        });
        playheadWrapCountRef.current = 1;
        await stopRecording(stopBeat);
        transportStore.set({ ...transportStore.value!, isPlaying: false, isRecording: false });
        playheadWrapCountRef.current = 0;
        flushAutomergeStorageWrites();
        midiStore.set({
            ...midiStore.value!,
            notesByClipId: { ...midiStore.value!.notesByClipId, [clip.id]: [...rows] },
        });
    }

    async function loopClip(endBeat: number): Promise<void> {
        await dispatch({ type: 'setClipLoop', payload: { clipId: recordedClipId(), enabled: true } });
        await dispatch({ type: 'setClipLoopLength', payload: { clipId: recordedClipId(), loopLength: 4 } });
        await dispatch({ type: 'trimClipEnd', payload: { clipId: recordedClipId(), newEndBeat: endBeat } });
    }

    async function compOver(name: string, startBeat: number, endBeat: number): Promise<void> {
        await dispatch({ type: 'setCompRegion', payload: { trackId, takeId: takeId(name), startBeat, endBeat } });
    }

    async function splitAt(beat: number): Promise<void> {
        await dispatch({
            type: 'splitClip',
            payload: { clipId: recordedClipId(), beat, rightClipId: `right-${beat}` },
        });
    }

    /** Every note the native engine is told to strike over the first 32 beats, as [pitch, beat]. */
    function heard(): [pitch: number, beat: number][] {
        const track = trackStore.value?.tracks[0];
        if (!track || !midiStore.value) {
            throw new Error('Expected a committed MIDI track and note store');
        }
        const programme = projectLiveMidiProgramme({
            stripTracks: [{ ...track, devices: [instrument('instrument', 'instance')] }],
            attachedInstanceIds: new Set(['instance']),
            bakedStripIds: new Set(),
            carriedStripIds: new Set([trackId]),
            notesByClipId: midiStore.value.notesByClipId,
            probabilitySeed: midiStore.value.probabilitySeed,
            defaultTempo: TEMPO,
            sampleRate: SAMPLE_RATE,
            changes: [],
            projectPpqEndpoints,
            projectMidiEvents: createGrooveMidiEventProjector(),
            selectProbability: recordingRoll,
            projectChordPitch: null,
            resolveArticulationId: null,
            span: { startSeconds: 0, endSeconds: 32 * SECONDS_PER_BEAT },
        });
        return programme.targets
            .flatMap(({ events }) => events.filter((event) => event.isNoteOn))
            .map((event): [number, number] => [event.note, event.time / SECONDS_PER_BEAT]);
    }

    /** Whether the lane's takes play from captured sources rather than their clips' live rows. */
    function frozenTakeNames(): string[] {
        return (takeLaneStore.value?.lanes[0]?.takes ?? [])
            .filter((take) => take.midiSource !== undefined)
            .map((take) => take.name);
    }

    function occurrencesOf(eventId: string): number[] {
        return rolls.filter((roll) => roll.eventId === eventId).map((roll) => roll.occurrence);
    }

    describe('a comp of Take 1 reaching past both ends of its own extent', () => {
        // Recorded from 6 and stopped at 11, Take 1 spans [8, 11) of the clip [6, 12) and reads
        // its pass head, media 6, at beat 8, so a row at media m sounds at m + 2. The comp over
        // [6, 12) plays its rows across the lead-in before 8 and the tail past 11 as well.
        const rows = [
            note({ id: 'base', pitch: 60, startBeat: 0.5, duration: 0.25, recordingPassIndex: 0 }),
            note({ id: 'lead-in', pitch: 72, startBeat: 4.25, duration: 0.25, recordingPassIndex: 1 }),
            note({ id: 'body', pitch: 74, startBeat: 7.5, duration: 0.25, recordingPassIndex: 1 }),
            note({ id: 'late', pitch: 76, startBeat: 8.5, duration: 0.25, recordingPassIndex: 1 }),
            note({ id: 'tail', pitch: 77, startBeat: 9.25, duration: 0.25, recordingPassIndex: 1 }),
        ];

        async function compTakeOneOverTheClip(): Promise<[number, number][]> {
            await recordLoop(6, 11, rows);
            await compOver('Take 1', 6, 12);
            expect(frozenTakeNames()).toEqual([]);
            const live = heard();
            expect(live).toEqual([
                [72, 6.25],
                [74, 9.5],
                [76, 10.5],
                [77, 11.25],
            ]);
            return live;
        }

        it('keeps the lead-in on the take when a split falls before the take starts', async () => {
            const live = await compTakeOneOverTheClip();

            await splitAt(7);

            expect(frozenTakeNames()).toContain('Take 1');
            expect(heard()).toEqual(live);
        });

        it('keeps the tail on the take when a split falls inside it', async () => {
            const live = await compTakeOneOverTheClip();

            await splitAt(10);

            expect(frozenTakeNames()).toContain('Take 1');
            expect(heard()).toEqual(live);
        });

        it('keeps the lead-in and the tail on the take across a Delete Time inside it', async () => {
            const live = await compTakeOneOverTheClip();

            await dispatch({ type: 'deleteTime', payload: { startBeat: 9, endBeat: 10 } });

            expect(frozenTakeNames()).toContain('Take 1');
            expect(heard()).toEqual(
                live
                    .filter(([, beat]) => beat < 9 || beat >= 10)
                    .map(([pitch, beat]): [number, number] => [pitch, beat < 9 ? beat : beat - 1])
            );
        });
    });

    describe('a looping comp of a pass recorded from the loop start', () => {
        // Pass 0 reads media 0 at its pass head 8; every row is a coin toss, so a pass rolled on
        // the wrong occurrence count sounds a different set of them.
        const chances = [0.25, 1.25, 2.25, 3.25].map((startBeat, index) =>
            note({
                id: `chance-${index}`,
                pitch: 60 + index,
                startBeat,
                duration: 0.25,
                probability: 50,
                recordingPassIndex: 0,
            })
        );

        async function compLoopingPass(): Promise<void> {
            await recordLoop(8, 9, chances);
            await loopClip(24);
            await compOver('Pass 0', 8, 24);
            expect(frozenTakeNames()).toEqual([]);
        }

        it('rolls every repeat on the same occurrence after a split on the loop grid', async () => {
            await compLoopingPass();
            const live = heard();
            expect(occurrencesOf('chance-0')).toEqual([0, 1, 2, 3]);
            expect(live.length).toBeGreaterThan(0);
            expect(live.length).toBeLessThan(16);

            await splitAt(16);
            rolls.length = 0;

            expect(frozenTakeNames()).toContain('Pass 0');
            expect(heard()).toEqual(live);
            expect(occurrencesOf('chance-0')).toEqual([0, 1, 2, 3]);
        });

        it('keeps counting the right half of an off-grid split on the take’s own occurrence grid', async () => {
            await compLoopingPass();
            const live = heard();
            // Live counts a repeat's occurrence from where the fragment's repeat opens, so the
            // row at 20.25 rolls on the repeat opening at 17 once the split puts a fragment edge
            // there; every other beat keeps the roll it had.
            const outsideTheRestart = ([, beat]: [number, number]) => beat < 20 || beat >= 21;

            await splitAt(17);
            rolls.length = 0;
            const frozen = heard();

            // The right half opens on 17, two loops past the pass head: occurrences 2 and 3, as live counts them.
            expect(occurrencesOf('chance-1')).toEqual([0, 1, 2, 3]);
            expect(frozen.filter(outsideTheRestart)).toEqual(live.filter(outsideTheRestart));
        });
    });
});
