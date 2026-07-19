import { trackStore } from '#/modules/Arrangement/stores';
import { resolveClipsWithComping, getSynthParamsForTrack } from '#/modules/Arrangement/useCases';
import {
    ensureTrackStrip,
    getAudioContext,
    getCompensationDelay,
    getCurrentTime,
    scheduleFaustNote,
} from '#/modules/AudioEngine/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import {
    getChordAtBeat,
    projectClipMidiEvents,
    projectCommittedGroove,
    transposeForChordTrack,
} from '#/modules/MIDI/useCases';
import { scheduleDrumKitNote, scheduleKitNote, scheduleNote } from '#/modules/Synth/useCases';
import { getYeastSchedulingLookahead, processYeastMidi } from '#/modules/Yeast/useCases';

import { beatToSamples, getTempoAtBeat, samplesToBeat, splitRangeAtTempoChanges } from '../../models/TempoMap';
import { getBarBeatAtPosition, getTimeSignatureAtBeat } from '../../models/TimeSignatureMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';
import { projectPpqEndpoints } from '../projectPpqEndpoints';

import { resolveDrumKit } from './resolveDrumKit';
import { resolveDrumKitDef } from './resolveDrumKitDef';
import { scheduleFrozenTrack } from './scheduleFrozenTrack';

// Worklet synth device types that share a common noteOn/noteOff controls interface.
// Each entry maps a device type to the controls property name on the device node
// and an optional velocity transform (defaults to identity).
type WorkletSynthEntry = {
    controlsKey: 'fermenterControls' | 'grandBouleControls' | 'levainControls';
    velocityTransform?: (velocity: number) => number;
};

const WORKLET_SYNTH_DEVICES: Record<string, WorkletSynthEntry> = {
    fermenter: { controlsKey: 'fermenterControls' },
    'grand-boule': {
        controlsKey: 'grandBouleControls',
        velocityTransform: (value: number) => value / 127,
    },
    levain: { controlsKey: 'levainControls' },
};

// Transport-local shapes (AGENTS.md model isolation). Structurally compatible
// with what Yeast's processors and Worker accept; we do not import Yeast's model.
type YeastMidiEventKind =
    | { type: 'noteOn'; channel: number; note: number; velocity: number }
    | { type: 'noteOff'; channel: number; note: number }
    | { type: 'cc'; channel: number; cc: number; value: number }
    | { type: 'pitchBend'; channel: number; value: number }
    | { type: 'channelPressure'; channel: number; value: number };

type MidiEvent = {
    timeSamples: number;
    kind: YeastMidiEventKind;
    trackId?: string;
    sourceEventId?: string;
    noteInstanceId?: string;
    timePpq?: number;
    tempoBpm?: number;
};

type ScheduledYeastNote<Note> = Note & {
    yeastStartSamples: number;
    yeastEndSamples: number;
    yeastStartPpq?: number;
    yeastEndPpq?: number;
    noteInstanceId?: string;
};

type GetScheduledYeastSamplesInput = {
    note: object;
    changes: Parameters<typeof beatToSamples>[0];
    defaultTempo: number;
    sampleRate: number;
};

function getScheduledYeastSamples({
    note,
    changes,
    defaultTempo,
    sampleRate,
}: GetScheduledYeastSamplesInput): { start: number; end: number } | null {
    if (
        'yeastStartPpq' in note &&
        typeof note.yeastStartPpq === 'number' &&
        'yeastEndPpq' in note &&
        typeof note.yeastEndPpq === 'number'
    ) {
        const endpoints = projectPpqEndpoints({
            startPpq: note.yeastStartPpq,
            endPpq: note.yeastEndPpq,
            defaultTempo,
            sampleRate,
            changes,
        });
        return {
            start: endpoints.startSamples,
            end: endpoints.endSamples,
        };
    }
    if (
        'yeastStartSamples' in note &&
        typeof note.yeastStartSamples === 'number' &&
        'yeastEndSamples' in note &&
        typeof note.yeastEndSamples === 'number'
    ) {
        return { start: note.yeastStartSamples, end: note.yeastEndSamples };
    }
    return null;
}

type TransportInfo = {
    sampleRate: number;
    bpm: number;
    ppqPosition: number;
    isPlaying: boolean;
    barIndex: number;
    beatInBar: number;
    timeSigNum: number;
    timeSigDen: number;
    loopEnabled: boolean;
    loopStartPpq: number;
    loopEndPpq: number;
};

export type SchedulerCancellation = {
    generation: number;
    isCurrent: () => boolean;
    sourceEpoch?: () => number;
};

/**
 * Deterministic pseudo-random number from a clip id + position seed.
 * Mirrors evaluateFollowActions' seededRandom so per-note probability gates
 * replay identically across sessions instead of using Math.random() (§55.3).
 */
function seededRandom(clipId: string, position: number): number {
    let h = 2166136261;
    for (let index = 0; index < clipId.length; index++) {
        h ^= clipId.charCodeAt(index);
        h = Math.imul(h, 16777619);
    }
    h ^= Math.floor(position * 1e4) | 0;
    h = Math.imul(h, 16777619);
    // Fold to [0, 1).
    return ((h >>> 0) % 1_000_000) / 1_000_000;
}

/** Toaster parent-device note controls shape (local — cross-module model isolation). */
type ToasterControls = {
    noteOn: (pad: number, velocity: number, pitchNote: number, sampleFrame?: number) => void;
};

export async function scheduleMidiNotes(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    lastScheduledBeat: number,
    activeAudioSources: AudioBufferSourceNode[],
    transport: TransportState,
    currentTempo: number,
    cancellation?: SchedulerCancellation
): Promise<void> {
    const isCurrent = cancellation?.isCurrent ?? (() => true);
    const tracks = trackStore.value?.tracks;
    const midiState = midiStore.value;
    if (!tracks || !midiState) {
        return;
    }

    const changes = tempoMapStore.value?.changes ?? [];

    for (const track of tracks) {
        if (!isCurrent()) {
            return;
        }
        if (track.kind !== 'midi' || track.muted) {
            continue;
        }

        if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
            scheduleFrozenTrack(track, accumulatedPosition, activeAudioSources, currentTempo);
            continue;
        }

        const drumKitDef = resolveDrumKitDef(track.devices);
        const drumKit = drumKitDef ? null : resolveDrumKit(track.devices);
        const resolvedClips = resolveClipsWithComping(track.id, track.clips);

        for (const clip of resolvedClips) {
            if (clip.muted) {
                continue;
            }
            if (clip.type !== 'midi') {
                continue;
            }
            const sourceNotes = midiState.notesByClipId[clip.id] as
                | NonNullable<(typeof midiState.notesByClipId)[string]>
                | undefined;
            if (!sourceNotes) {
                continue;
            }
            const notes = projectCommittedGroove({
                events: sourceNotes,
                consumerType: 'clip',
                consumerId: clip.id,
            });

            const hasYeast = track.devices.some((data) => data.type === 'yeast');
            // §2 — When the clip loops, run the Yeast Worker once per loop
            // iteration over that iteration's absolute window, so bar-aware
            // processors see iter-correct transport metadata instead of the
            // first iteration's bar replayed at every offset. The transformed
            // notes are emitted clip-relative (no iterOffset baked in), matching
            // what the per-note scheduling loop reconstructs below.
            // `notes` is narrowed non-undefined past the guard above; deriving the
            // iteration result type from it (rather than `typeof midiState.notesByClipId`)
            // avoids a `typeof` query on the still-nullable `midiState` binding, whose
            // declared type is not narrowed inside this type position.
            let runYeastForIteration:
                | ((iterAbsBase: number) => Promise<Array<ScheduledYeastNote<(typeof notes)[number]>> | null>)
                | null = null;
            const clipMidiOffset = clip.midiOffsetBeats ?? 0;
            if (hasYeast) {
                const rawNotes = notes;
                const { earlyBeats: sourceLookaheadBeats } = getYeastSchedulingLookahead();
                runYeastForIteration = async (iterAbsBase: number) => {
                    const yeastSr = getAudioContext().sampleRate;
                    const tsChanges = timeSignatureMapStore.value?.changes ?? [];
                    const ctx = getAudioContext();
                    const processed: MidiEvent[] = [];
                    for (const block of splitRangeAtTempoChanges(changes, fromBeat, toBeat)) {
                        if (!isCurrent()) {
                            return null;
                        }
                        const blockTempo = getTempoAtBeat(changes, block.fromBeat, transport.tempo);
                        const barBeat = getBarBeatAtPosition(
                            tsChanges,
                            block.fromBeat,
                            transport.timeSignatureNumerator,
                            transport.timeSignatureDenominator
                        );
                        const blockTimeSig = getTimeSignatureAtBeat(
                            tsChanges,
                            block.fromBeat,
                            transport.timeSignatureNumerator,
                            transport.timeSignatureDenominator
                        );
                        const yeastTransport: TransportInfo = {
                            sampleRate: yeastSr,
                            bpm: blockTempo,
                            ppqPosition: block.fromBeat,
                            isPlaying: true,
                            barIndex: barBeat.bar - 1,
                            beatInBar: barBeat.beat - 1 + barBeat.tick / 480,
                            timeSigNum: blockTimeSig.numerator,
                            timeSigDen: blockTimeSig.denominator,
                            loopEnabled: transport.loopStart < transport.loopEnd,
                            loopStartPpq: transport.loopStart,
                            loopEndPpq: transport.loopEnd,
                        };

                        const midiEvents: MidiEvent[] = [];
                        for (const [noteIndex, node] of rawNotes.entries()) {
                            const noteStartBeat = iterAbsBase + node.startBeat;
                            if (
                                noteStartBeat < block.fromBeat ||
                                noteStartBeat >= block.toBeat + sourceLookaheadBeats
                            ) {
                                continue;
                            }
                            const sourceEpoch =
                                cancellation === undefined
                                    ? 0
                                    : (cancellation.sourceEpoch?.() ?? cancellation.generation);
                            const sourceIdentity = `${sourceEpoch}:${track.id}:${clip.id}:${iterAbsBase}:${node.id}:${noteIndex}`;
                            const noteEndBeat = noteStartBeat + node.duration;
                            const sourceEndpoints = projectPpqEndpoints({
                                startPpq: noteStartBeat,
                                endPpq: noteEndBeat,
                                defaultTempo: transport.tempo,
                                sampleRate: yeastSr,
                                changes,
                            });
                            midiEvents.push({
                                timeSamples: sourceEndpoints.startSamples,
                                trackId: track.id,
                                sourceEventId: `${sourceIdentity}:on`,
                                noteInstanceId: sourceIdentity,
                                timePpq: noteStartBeat,
                                tempoBpm: getTempoAtBeat(changes, noteStartBeat, transport.tempo),
                                kind: {
                                    type: 'noteOn',
                                    channel: 0,
                                    note: node.pitch,
                                    velocity: node.velocity,
                                },
                            });
                            midiEvents.push({
                                timeSamples: sourceEndpoints.endSamples,
                                trackId: track.id,
                                sourceEventId: `${sourceIdentity}:off`,
                                noteInstanceId: sourceIdentity,
                                timePpq: noteEndBeat,
                                tempoBpm: getTempoAtBeat(changes, noteEndBeat, transport.tempo),
                                kind: { type: 'noteOff', channel: 0, note: node.pitch },
                            });
                        }

                        const blockProcessed = await processYeastMidi({
                            context: ctx,
                            trackId: track.id,
                            events: midiEvents,
                            blockStartSamples: beatToSamples(changes, block.fromBeat, transport.tempo, yeastSr),
                            blockEndSamples: beatToSamples(changes, block.toBeat, transport.tempo, yeastSr),
                            transport: yeastTransport,
                        });
                        if (!isCurrent()) {
                            return null;
                        }
                        processed.push(...blockProcessed);
                    }

                    // §154.1 — Build a per-note index of noteOff events so the
                    // noteOn → noteOff match is O(1) instead of O(N) per noteOn.
                    // Events within `processed` are time-ordered by construction,
                    // so a single forward pass produces stacks of pending-off
                    // timeSamples per pitch. A noteOn then pops the earliest
                    // noteOff whose time > startTime.
                    const noteOffsByInstance = new Map<string, { timeSamples: number; timePpq?: number }>();
                    const legacyNoteOffsByKey = new Map<number, Array<{ timeSamples: number; timePpq?: number }>>();
                    for (const evt of processed) {
                        if (evt.kind.type === 'noteOff') {
                            const endpoint = { timeSamples: evt.timeSamples, timePpq: evt.timePpq };
                            if (evt.noteInstanceId) {
                                noteOffsByInstance.set(evt.noteInstanceId, endpoint);
                                continue;
                            }
                            const noteKey = evt.kind.channel * 128 + evt.kind.note;
                            const existing = legacyNoteOffsByKey.get(noteKey);
                            if (existing) {
                                existing.push(endpoint);
                            } else {
                                legacyNoteOffsByKey.set(noteKey, [endpoint]);
                            }
                        }
                    }
                    const noteOffCursor = new Map<number, number>();

                    // §6 — A Yeast generator (e.g. EuclideanGenerator) can emit
                    // notes even when the source clip has none. In that case
                    // `rawNotes[0]` is undefined and spreading it would yield
                    // notes missing id / probability / MPE fields. Use the first
                    // source note as a template when present, otherwise a
                    // fully-specified default so every generated note is a
                    // complete MidiNote.
                    const noteTemplate: NonNullable<(typeof midiState.notesByClipId)[string]>[number] = rawNotes[0] ?? {
                        id: clip.id,
                        pitch: 60,
                        startBeat: 0,
                        duration: 0,
                        velocity: 100,
                        probability: 100,
                    };

                    const transformedNotes: Array<ScheduledYeastNote<(typeof notes)[number]>> = [];
                    for (const evt of processed) {
                        if (evt.kind.type === 'noteOn') {
                            const evtNote = evt.kind.note;
                            const evtVel = evt.kind.velocity;
                            // Emit the Worker output at its absolute beat, less
                            // the clip's MIDI content offset (preserving the
                            // original behaviour, which applied midiOffset to the
                            // Worker output). The per-note loop consumes these
                            // notes by their absolute beat directly — it does not
                            // re-apply iterOffset / midiOffset, since this
                            // iteration's run already placed them.
                            const startBeat =
                                (evt.timePpq ?? samplesToBeat(changes, evt.timeSamples, transport.tempo, yeastSr)) -
                                clipMidiOffset;

                            const noteKey = evt.kind.channel * 128 + evtNote;
                            const offs = evt.noteInstanceId ? undefined : legacyNoteOffsByKey.get(noteKey);
                            let offEvent: { timeSamples: number; timePpq?: number } | null = evt.noteInstanceId
                                ? (noteOffsByInstance.get(evt.noteInstanceId) ?? null)
                                : null;
                            if (!evt.noteInstanceId && offs) {
                                let cursor = noteOffCursor.get(noteKey) ?? 0;
                                while (cursor < offs.length && offs[cursor]!.timeSamples <= evt.timeSamples) {
                                    cursor++;
                                }
                                if (cursor < offs.length) {
                                    offEvent = offs[cursor]!;
                                    noteOffCursor.set(noteKey, cursor + 1);
                                } else {
                                    noteOffCursor.set(noteKey, cursor);
                                }
                            }
                            const endBeat =
                                offEvent !== null
                                    ? (offEvent.timePpq ??
                                          samplesToBeat(changes, offEvent.timeSamples, transport.tempo, yeastSr)) -
                                      clipMidiOffset
                                    : startBeat + 0.25;
                            transformedNotes.push({
                                ...noteTemplate,
                                id: `${noteTemplate.id}:yeast:${evtNote}:${evt.timeSamples}`,
                                noteInstanceId: evt.noteInstanceId,
                                pitch: evtNote,
                                velocity: evtVel,
                                startBeat,
                                duration: endBeat - startBeat,
                                yeastStartSamples: evt.timeSamples,
                                yeastEndSamples:
                                    offEvent?.timeSamples ??
                                    beatToSamples(changes, endBeat + clipMidiOffset, transport.tempo, yeastSr),
                                yeastStartPpq: evt.timePpq,
                                yeastEndPpq: offEvent?.timePpq,
                            });
                        }
                    }
                    return transformedNotes;
                };
            }

            const synthParams = drumKit || drumKitDef ? null : getSynthParamsForTrack(track.id);
            const compensation = getCompensationDelay(track.id);
            const clipVisualLength = clip.endBeat - clip.startBeat;
            if (clipVisualLength <= 0) {
                continue;
            }
            const rawLoopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
            const loopLen = rawLoopLen > 0 ? rawLoopLen : clipVisualLength;
            const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;
            const strip = ensureTrackStrip(track.id);
            const ctx = getAudioContext();
            const sr = ctx.sampleRate;

            // §154.2 — Hoist parent-track + sibling-pad resolution out of the
            // per-note loop. These are functions of (track, tracks) only and
            // never change while we iterate notes.
            // §154.3 — Pre-resolve the per-track dispatch decision so the
            // note loop is a single switch instead of 4+ device array scans
            // per note (drumKitDef | drumKit | toasterChild | workletSynth |
            // faust | default synth).
            let toasterRoute: {
                controls: ToasterControls;
                pad: number;
                pitchFallback: number;
            } | null = null;
            if (track.parentId) {
                const toasterParentTrack = tracks.find((time1) => time1.id === track.parentId);
                const toasterDevice = toasterParentTrack?.devices.find((data) => data.type === 'toaster');
                if (toasterParentTrack && toasterDevice) {
                    const parentStrip = ensureTrackStrip(toasterParentTrack.id);
                    const dn = parentStrip?.deviceNodes.find(
                        (data) => data.deviceId === toasterDevice.id || data.type === 'toaster'
                    );
                    if (dn?.toasterControls) {
                        let pad = -1;
                        let childIdx = 0;
                        for (const time1 of tracks) {
                            if (time1.parentId === toasterParentTrack.id) {
                                if (time1.id === track.id) {
                                    pad = childIdx;
                                    break;
                                }
                                childIdx++;
                            }
                        }
                        toasterRoute = { controls: dn.toasterControls, pad, pitchFallback: 60 };
                    }
                }
            }

            const workletSynthDevice = toasterRoute
                ? null
                : track.devices.find((data) => data.type in WORKLET_SYNTH_DEVICES);
            const workletSynthEntry = workletSynthDevice
                ? (WORKLET_SYNTH_DEVICES[workletSynthDevice.type] ?? null)
                : null;
            const workletSynthNode = workletSynthDevice
                ? (strip.deviceNodes.find((data) => data.deviceId === workletSynthDevice.id) ?? null)
                : null;
            const workletSynthControls =
                workletSynthEntry && workletSynthNode
                    ? (workletSynthNode[workletSynthEntry.controlsKey] ?? null)
                    : null;

            const faustDevice =
                toasterRoute || drumKitDef || drumKit || workletSynthControls
                    ? null
                    : track.devices.find((data) => data.type.startsWith('faust-'));

            for (let iter = 0; iter < maxIterations; iter++) {
                const iterOffset = iter * loopLen;

                // §2 — For a Yeast track, run the Worker per loop iteration with
                // iter-correct transport metadata. The returned notes carry their
                // absolute beat directly, so the per-note loop must not re-apply
                // iterOffset / midiOffset to them.
                const iterNotes = runYeastForIteration
                    ? await runYeastForIteration(clip.startBeat + iterOffset)
                    : notes;
                if (!isCurrent()) {
                    return;
                }
                if (!iterNotes) {
                    continue;
                }
                const notesAreAbsolute = runYeastForIteration !== null;

                for (const note of iterNotes) {
                    if (!notesAreAbsolute && note.startBeat - clipMidiOffset >= loopLen) {
                        continue;
                    }

                    const rawStartBeat = notesAreAbsolute
                        ? note.startBeat
                        : clip.startBeat + iterOffset + (note.startBeat - clipMidiOffset);
                    const iterationStart = clip.startBeat + iterOffset;
                    const [projectedNote] = projectClipMidiEvents({
                        events: [note],
                        clipId: clip.id,
                        clipStartBeat: clip.startBeat,
                        clipEndBeat: clip.endBeat,
                        iterationStartBeat: iterationStart,
                        loopLengthBeats: loopLen,
                        midiOffsetBeats: clipMidiOffset,
                        clipGrooveAlreadyApplied: true,
                        eventsAreAbsolute: notesAreAbsolute,
                    });
                    if (!projectedNote) {
                        continue;
                    }
                    const noteStartBeat = projectedNote.startBeat;

                    const inSchedulingWindow = notesAreAbsolute
                        ? noteStartBeat >= fromBeat && noteStartBeat < toBeat
                        : noteStartBeat >= fromBeat && noteStartBeat < toBeat && noteStartBeat > lastScheduledBeat;
                    if (inSchedulingWindow) {
                        if (!isCurrent()) {
                            return;
                        }
                        const probability = note.probability ?? 100;
                        if (probability < 100 && seededRandom(clip.id, noteStartBeat) * 100 >= probability) {
                            continue;
                        }

                        let pitch = note.pitch;
                        if (track.followChordTrack && !drumKitDef && !drumKit) {
                            const refChord = getChordAtBeat(clip.startBeat);
                            const targetChord = getChordAtBeat(noteStartBeat);
                            pitch = transposeForChordTrack(pitch, refChord, targetChord);
                        }

                        const noteEndBeat = noteStartBeat + projectedNote.duration;
                        const returnedSamples = getScheduledYeastSamples({
                            note,
                            changes,
                            defaultTempo: transport.tempo,
                            sampleRate: sr,
                        });
                        const sequencerTimingUnchanged =
                            projectedNote.startBeat === rawStartBeat && projectedNote.duration === note.duration;
                        const projectedEndpoints = projectPpqEndpoints({
                            startPpq: noteStartBeat,
                            endPpq: noteEndBeat,
                            defaultTempo: transport.tempo,
                            sampleRate: sr,
                            changes,
                        });
                        const noteStartSamples =
                            returnedSamples !== null && sequencerTimingUnchanged
                                ? returnedSamples.start
                                : projectedEndpoints.startSamples;
                        const clipEndSamples = projectPpqEndpoints({
                            startPpq: clip.endBeat,
                            endPpq: clip.endBeat,
                            defaultTempo: transport.tempo,
                            sampleRate: sr,
                            changes,
                        }).endSamples;
                        const noteEndSamples = Math.min(
                            returnedSamples !== null && sequencerTimingUnchanged
                                ? returnedSamples.end
                                : projectedEndpoints.endSamples,
                            clipEndSamples
                        );
                        const accumulatedSamples = beatToSamples(changes, accumulatedPosition, transport.tempo, sr);
                        const time = getCurrentTime() + (noteStartSamples - accumulatedSamples) / sr + compensation;
                        const sampleFrame = Math.round(time * sr);
                        const durationSamples = noteEndSamples - noteStartSamples;
                        const duration = durationSamples / sr;
                        const endSampleFrame = sampleFrame + durationSamples;

                        if (toasterRoute) {
                            let pad = toasterRoute.pad;
                            let pitchNote = pitch;
                            if (pad === -1) {
                                pad = pitch - 36;
                                if (pad >= 24 && pad <= 39) {
                                    pad = pad - 24;
                                }
                                pitchNote = toasterRoute.pitchFallback;
                            }
                            if (pad >= 0 && pad < 16) {
                                const safeVelocity = projectedNote.velocity;
                                toasterRoute.controls.noteOn(pad, safeVelocity, pitchNote, sampleFrame);
                            }
                        } else if (drumKitDef) {
                            scheduleDrumKitNote(
                                ctx,
                                strip.gainNode,
                                drumKitDef,
                                pitch,
                                time,
                                projectedNote.velocity,
                                clip.gain
                            );
                        } else if (drumKit) {
                            scheduleKitNote(
                                ctx,
                                strip.gainNode,
                                drumKit,
                                pitch,
                                time,
                                duration,
                                projectedNote.velocity,
                                clip.gain
                            );
                        } else if (workletSynthControls && workletSynthEntry) {
                            const rawVel = projectedNote.velocity;
                            const vel = workletSynthEntry.velocityTransform
                                ? workletSynthEntry.velocityTransform(rawVel)
                                : rawVel;
                            workletSynthControls.noteOn(pitch, vel, sampleFrame);
                            workletSynthControls.noteOff(pitch, endSampleFrame);
                        } else if (faustDevice) {
                            scheduleFaustNote(
                                track.id,
                                faustDevice.id,
                                pitch,
                                time,
                                duration,
                                projectedNote.velocity,
                                clip.gain
                            );
                        } else {
                            const mpe =
                                note.pressure !== undefined || note.slide !== undefined || note.pitchBend !== undefined
                                    ? { pressure: note.pressure, slide: note.slide, pitchBend: note.pitchBend }
                                    : undefined;
                            scheduleNote(
                                ctx,
                                strip.gainNode,
                                pitch,
                                time,
                                duration,
                                projectedNote.velocity,
                                synthParams!,
                                mpe,
                                clip.gain
                            );
                        }
                    }
                }
            }
        }
    }
}
