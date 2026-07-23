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
    shouldPlayMidiEvent,
    transposeForChordTrack,
} from '#/modules/MIDI/useCases';
import { scheduleDrumKitNote, scheduleKitNote, scheduleNote } from '#/modules/Synth/useCases';

import { beatToSamples } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

import { processLiveYeastTrackBlock, type LiveYeastIteration, type LiveYeastNote } from './processLiveYeastTrackBlock';
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

export type SchedulerCancellation = {
    generation: number;
    /** Semantic timeline identity; unlike generation, loop wraps and jumps advance it without cancellation. */
    discontinuityEpoch: number;
    isCurrent: () => boolean;
};

/** Toaster parent-device note controls shape (local — cross-module model isolation). */
type ToasterControls = {
    noteOn: (pad: number, velocity: number, pitchNote: number, sampleFrame?: number) => void;
};

type GetSourceOccurrenceOffsetInput = {
    sourceStartBeat: number;
    segmentStartBeat: number;
    loopLength: number;
    loopEnabled: boolean;
};

function getSourceOccurrenceOffset({
    sourceStartBeat,
    segmentStartBeat,
    loopLength,
    loopEnabled,
}: GetSourceOccurrenceOffsetInput): number {
    if (!loopEnabled || loopLength <= 0) {
        return 0;
    }

    const beatsFromSourceStart = segmentStartBeat - sourceStartBeat;
    if (beatsFromSourceStart <= 0) {
        return 0;
    }

    return Math.floor(beatsFromSourceStart / loopLength);
}

export async function scheduleMidiNotes(
    fromBeat: number,
    toBeat: number,
    accumulatedPosition: number,
    lastScheduledBeat: number,
    scheduledFrozenTracks: Set<string>,
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
            // Dedup per session (same contract as scheduleAudioClips): the
            // whole frozen buffer is scheduled in a single shot anchored to the
            // absolute start time, so without the guard every 10 ms tick would
            // layer another copy of the track on top of the previous ones.
            // The key includes the frozenBufferId so an unfreeze → refreeze
            // (same track.id, new buffer) invalidates the dedup entry and the
            // refrozen render is scheduled instead of staying silent for the
            // rest of the session.
            const frozenKey = `${track.id}:${track.freezeState.frozenBufferId}`;
            if (!scheduledFrozenTracks.has(frozenKey)) {
                const scheduled = scheduleFrozenTrack(track, accumulatedPosition, activeAudioSources, currentTempo);
                if (scheduled) {
                    scheduledFrozenTracks.add(frozenKey);
                }
            }
            continue;
        }

        const drumKitDef = resolveDrumKitDef(track.devices);
        const drumKit = drumKitDef ? null : resolveDrumKit(track.devices);
        const resolvedClips = resolveClipsWithComping(track.id, track.clips);
        const yeastDevice = track.devices.find((device) => device.type === 'yeast');
        const liveYeastIterations: LiveYeastIteration[] = [];
        let activeYeastCarrierRouteId: string | undefined;

        if (yeastDevice) {
            for (const clip of resolvedClips) {
                if (clip.muted || clip.type !== 'midi') {
                    continue;
                }
                const sourceNotes = midiState.notesByClipId[clip.id];
                if (!sourceNotes) {
                    continue;
                }

                const clipVisualLength = clip.endBeat - clip.startBeat;
                const loopLength = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
                if (loopLength <= 0) {
                    continue;
                }
                const sourceOccurrenceOffset = getSourceOccurrenceOffset({
                    sourceStartBeat: clip.sourceStartBeat,
                    segmentStartBeat: clip.startBeat,
                    loopLength,
                    loopEnabled: clip.loopEnabled ?? false,
                });
                const iterationCount = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLength) : 1;
                for (let iteration = 0; iteration < iterationCount; iteration++) {
                    const absoluteOccurrenceIndex = sourceOccurrenceOffset + iteration;
                    const iterationStartBeat = clip.startBeat + iteration * loopLength;
                    const iterationEndBeat = Math.min(iterationStartBeat + loopLength, clip.endBeat);
                    const routeId = `live-yeast:${track.id}:${clip.id}:${absoluteOccurrenceIndex}`;
                    liveYeastIterations.push({
                        routeId,
                        clipId: clip.id,
                        iterationStartBeat,
                        iterationEndBeat,
                        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
                        sourceNotes: sourceNotes.filter((note) =>
                            shouldPlayMidiEvent({
                                projectProbabilitySeed: midiState.probabilitySeed,
                                clipId: clip.id,
                                eventId: note.id,
                                absoluteOccurrenceIndex,
                                probabilityPercent: note.probability ?? 100,
                            })
                        ),
                    });
                    if (
                        activeYeastCarrierRouteId === undefined &&
                        iterationEndBeat > fromBeat &&
                        iterationStartBeat < toBeat
                    ) {
                        activeYeastCarrierRouteId = routeId;
                    }
                }
            }
        }

        const liveYeastNotesByRoute = new Map<string, LiveYeastNote[]>();
        const trackScopedYeastNoteIds = new Set<string>();
        if (yeastDevice && activeYeastCarrierRouteId !== undefined) {
            const yeastResult = await processLiveYeastTrackBlock({
                context: getAudioContext(),
                rackId: yeastDevice.id,
                trackId: track.id,
                iterations: liveYeastIterations,
                fromBeat,
                toBeat,
                changes,
                timeSignatureChanges: timeSignatureMapStore.value?.changes ?? [],
                transport,
                discontinuityEpoch: cancellation?.discontinuityEpoch,
                isCurrent,
            });
            if (!yeastResult) {
                return;
            }
            for (const [routeId, routeNotes] of yeastResult.notesByRoute) {
                liveYeastNotesByRoute.set(routeId, routeNotes);
            }
            if (yeastResult.generatedNotes.length > 0) {
                for (const note of yeastResult.generatedNotes) {
                    const [projectedNote] = projectCommittedGroove({
                        events: [note],
                        consumerType: 'sequencer',
                        consumerId: 'project',
                    });
                    const carrierIteration = liveYeastIterations.find(
                        (iteration) =>
                            projectedNote &&
                            iteration.iterationStartBeat <= projectedNote.startBeat &&
                            projectedNote.startBeat < iteration.iterationEndBeat
                    );
                    if (!projectedNote || !carrierIteration) {
                        continue;
                    }
                    const carrierNotes = liveYeastNotesByRoute.get(carrierIteration.routeId) ?? [];
                    carrierNotes.push(projectedNote);
                    liveYeastNotesByRoute.set(carrierIteration.routeId, carrierNotes);
                    trackScopedYeastNoteIds.add(projectedNote.id);
                }
            }
        }

        for (const clip of resolvedClips) {
            if (clip.muted) {
                continue;
            }
            if (clip.type !== 'midi') {
                continue;
            }
            const notes = midiState.notesByClipId[clip.id];
            if (!notes) {
                continue;
            }

            const clipMidiOffset = clip.midiOffsetBeats ?? 0;
            const synthParams = drumKit || drumKitDef ? null : getSynthParamsForTrack(track.id);
            const compensation = getCompensationDelay(track.id);
            const clipVisualLength = clip.endBeat - clip.startBeat;
            const loopLen = clip.loopEnabled ? (clip.loopLength ?? clipVisualLength) : clipVisualLength;
            if (loopLen <= 0) {
                continue;
            }
            const maxIterations = clip.loopEnabled ? Math.ceil(clipVisualLength / loopLen) : 1;
            const sourceOccurrenceOffset = getSourceOccurrenceOffset({
                sourceStartBeat: clip.sourceStartBeat,
                segmentStartBeat: clip.startBeat,
                loopLength: loopLen,
                loopEnabled: clip.loopEnabled ?? false,
            });
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
                const absoluteOccurrenceIndex = sourceOccurrenceOffset + iter;
                const iterOffset = iter * loopLen;
                const yeastRouteId = `live-yeast:${track.id}:${clip.id}:${absoluteOccurrenceIndex}`;
                const iterNotes = yeastDevice ? (liveYeastNotesByRoute.get(yeastRouteId) ?? []) : notes;
                const notesAreAbsolute = yeastDevice !== undefined;

                for (const note of iterNotes) {
                    const isTrackScopedYeastNote = trackScopedYeastNoteIds.has(note.id);
                    if (!notesAreAbsolute && note.startBeat - clipMidiOffset >= loopLen) {
                        continue;
                    }

                    const iterationStart = clip.startBeat + iterOffset;
                    let projectedNotes: readonly LiveYeastNote[];
                    if (isTrackScopedYeastNote) {
                        projectedNotes = [note];
                    } else {
                        projectedNotes = projectClipMidiEvents({
                            events: [note],
                            clipId: clip.id,
                            clipStartBeat: clip.startBeat,
                            clipEndBeat: clip.endBeat,
                            iterationStartBeat: iterationStart,
                            loopLengthBeats: loopLen,
                            midiOffsetBeats: clipMidiOffset,
                            loopEnabled: clip.loopEnabled ?? false,
                            clipGrooveAlreadyApplied: notesAreAbsolute,
                            eventsAreAbsolute: notesAreAbsolute,
                        });
                    }

                    for (const projectedNote of projectedNotes) {
                        const noteStartBeat = projectedNote.startBeat;
                        if (noteStartBeat < fromBeat || noteStartBeat >= toBeat || noteStartBeat <= lastScheduledBeat) {
                            continue;
                        }
                        if (!isCurrent()) {
                            return;
                        }
                        if (!yeastDevice) {
                            const shouldPlay = shouldPlayMidiEvent({
                                projectProbabilitySeed: midiState.probabilitySeed,
                                clipId: clip.id,
                                eventId: note.id,
                                absoluteOccurrenceIndex,
                                probabilityPercent: note.probability ?? 100,
                            });
                            if (!shouldPlay) {
                                continue;
                            }
                        }

                        let pitch = note.pitch;
                        if (track.followChordTrack && !drumKitDef && !drumKit && !toasterRoute) {
                            const refChord = getChordAtBeat(clip.startBeat);
                            const targetChord = getChordAtBeat(noteStartBeat);
                            pitch = transposeForChordTrack(pitch, refChord, targetChord);
                        }

                        const iterationEndBeat = Math.min(iterationStart + loopLen, clip.endBeat);
                        const noteEndBeat = isTrackScopedYeastNote
                            ? Math.min(noteStartBeat + projectedNote.duration, iterationEndBeat)
                            : noteStartBeat + projectedNote.duration;
                        const noteStartSamples = beatToSamples(changes, noteStartBeat, transport.tempo, sr);
                        const noteEndSamples = beatToSamples(changes, noteEndBeat, transport.tempo, sr);
                        const accumulatedSamples = beatToSamples(changes, accumulatedPosition, transport.tempo, sr);
                        const time = getCurrentTime() + (noteStartSamples - accumulatedSamples) / sr + compensation;
                        const sampleFrame = Math.round(time * sr);
                        const durationSamples = noteEndSamples - noteStartSamples;
                        const duration = durationSamples / sr;
                        const endSampleFrame = sampleFrame + durationSamples;
                        const noteGain = isTrackScopedYeastNote ? 1 : clip.gain;

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
                                noteGain
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
                                noteGain
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
                                noteGain
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
                                noteGain
                            );
                        }
                    }
                }
            }
        }
    }
}
