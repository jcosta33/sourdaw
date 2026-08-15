import { trackStore } from '#/modules/Arrangement/stores';
import { getSynthParamsForTrack, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import {
    applyNoteExpression,
    ensureTrackStrip,
    getAudioContext,
    getCompensationDelay,
    getCurrentTime,
    getDefaultBendRangeSemitones,
    registerScheduledSource,
    scheduleFaustNote,
} from '#/modules/AudioEngine/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationValueAtBeat, isRecordingAutomation } from '#/modules/Automation/useCases';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import {
    getChordAtBeat,
    projectClipMidiEvents,
    projectCommittedGroove,
    resolveMidiNoteArticulationId,
    shouldPlayMidiEvent,
    transposeForChordTrack,
} from '#/modules/MIDI/useCases';
import { isFaustInstrumentModule } from '#/modules/PluginHost/useCases';
import { scheduleDrumKitNote, scheduleKitNote, scheduleNote } from '#/modules/Synth/useCases';
import { toasterStore } from '#/modules/Toaster/stores';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';
import { resolveToasterPadIndex, TOASTER_NEUTRAL_MIDI_NOTE } from '#/utils/toasterNoteProjection';
import { getToasterSwingOffsetBeats } from '#/utils/toasterSwingProjection';

import { beatToSamples } from '../../models/TempoMap';
import { type TransportState } from '../../models/TransportState';
import { tempoMapStore } from '../../stores/tempoMapStore';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

import { processLiveYeastTrackBlock, type LiveYeastIteration, type LiveYeastNote } from './processLiveYeastTrackBlock';
import { resolveDrumKit } from './resolveDrumKit';
import { resolveDrumKitDef } from './resolveDrumKitDef';
import { scheduleFrozenTrack } from './scheduleFrozenTrack';
import { selectMidiClipsForSchedulerWindow } from './selectMidiClipsForSchedulerWindow';
import { selectMidiNotesForLoopWindow } from './selectMidiNotesForLoopWindow';

// Worklet synth device types that share a common noteOn/noteOff controls interface.
// Each entry maps a device type to the controls property name on the device node
// and an optional velocity transform (defaults to identity).
type WorkletSynthEntry = {
    controlsKey: 'fermenterControls' | 'grandBouleControls' | 'levainControls' | 'crumbsControls';
    velocityTransform?: (velocity: number) => number;
};

const WORKLET_SYNTH_DEVICES: Record<string, WorkletSynthEntry> = {
    fermenter: { controlsKey: 'fermenterControls' },
    'grand-boule': {
        controlsKey: 'grandBouleControls',
        velocityTransform: (value: number) => value / 127,
    },
    levain: { controlsKey: 'levainControls' },
    // Crumbs' catalog id carries the `builtin-` prefix. Without this row a
    // Crumbs track fell through to the built-in fallback synth here while the
    // offline render voiced the real sampler — the same live/offline split the
    // device's export refusal was hiding, just pointing the other way.
    'builtin-crumbs': { controlsKey: 'crumbsControls' },
};

export type SchedulerCancellation = {
    generation: number;
    /** Semantic timeline identity; unlike generation, loop wraps and jumps advance it without cancellation. */
    discontinuityEpoch: number;
    isCurrent: () => boolean;
    yeastRouteLineage: Map<string, LiveYeastIteration>;
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

/** Local view of the built-in synth's MPE params (cross-module model isolation). */
type ScheduledMpeParams = {
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
};

type ScheduledMidiNote = MidiStoreState['notesByClipId'][string][number];
type ScheduledMidiNoteIndex = {
    maxDurationBeats: number;
    maxEndpointBeat: number;
    minEndpointBeat: number;
    orderByNote: ReadonlyMap<ScheduledMidiNote, number>;
    sortedNoteEnds: readonly ScheduledMidiNote[];
    sortedNotes: readonly ScheduledMidiNote[];
};
type SelectMidiNotesForSchedulerWindowInput = {
    notes: readonly ScheduledMidiNote[];
    iterationStartBeat: number;
    midiOffsetBeats: number;
    fromBeat: number;
    toBeat: number;
    lastScheduledBeat: number;
};
type SelectYeastNotesForSchedulerWindowInput = {
    notes: readonly ScheduledMidiNote[];
    iterationStartBeat: number;
    fromBeat: number;
    toBeat: number;
};
type ScheduledIterationRange = {
    endIndex: number;
    startIndex: number;
};
type GetScheduledIterationRangeInput = {
    clipStartBeat: number;
    fromBeat: number;
    iterationCount: number;
    loopEnabled: boolean;
    loopLengthBeats: number;
    toBeat: number;
};

const MAX_GROOVE_STAGE_DISPLACEMENT_BEATS = 0.25;
// Clip and sequencer groove each move a note by at most 0.25 beats, so one beat
// is twice their combined legal displacement and cannot discard a note that
// either groove stage could move into the current scheduler grain.
const MIDI_NOTE_GROOVE_LOOKAROUND_BEATS = 1;
// MIDI writes replace note arrays rather than mutating them, so array identity
// invalidates this cache whenever project truth changes.
const scheduledMidiNoteIndexes = new WeakMap<readonly ScheduledMidiNote[], ScheduledMidiNoteIndex>();

function getScheduledMidiNoteIndex(notes: readonly ScheduledMidiNote[]): ScheduledMidiNoteIndex {
    const cached = scheduledMidiNoteIndexes.get(notes);
    if (cached) {
        return cached;
    }

    const orderByNote = new Map(notes.map((note, index) => [note, index]));
    const sortedNotes = [...notes].sort((left, right) => left.startBeat - right.startBeat);
    const sortedNoteEnds = [...notes].sort(
        (left, right) => left.startBeat + left.duration - right.startBeat - right.duration
    );
    const created = {
        maxDurationBeats: notes.reduce((maximum, note) => Math.max(maximum, note.duration), 0),
        maxEndpointBeat: notes.reduce(
            (maximum, note) => Math.max(maximum, note.startBeat, note.startBeat + note.duration),
            Number.NEGATIVE_INFINITY
        ),
        minEndpointBeat: notes.reduce(
            (minimum, note) => Math.min(minimum, note.startBeat, note.startBeat + note.duration),
            Number.POSITIVE_INFINITY
        ),
        orderByNote,
        sortedNoteEnds,
        sortedNotes,
    };
    scheduledMidiNoteIndexes.set(notes, created);
    return created;
}

function lowerBoundMidiNoteStart(notes: readonly ScheduledMidiNote[], startBeat: number): number {
    let low = 0;
    let high = notes.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (notes[middle]!.startBeat < startBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function lowerBoundMidiNoteEnd(notes: readonly ScheduledMidiNote[], endBeat: number): number {
    let low = 0;
    let high = notes.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        const note = notes[middle]!;
        if (note.startBeat + note.duration < endBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function selectMidiNotesForSchedulerWindow({
    notes,
    iterationStartBeat,
    midiOffsetBeats,
    fromBeat,
    toBeat,
    lastScheduledBeat,
}: SelectMidiNotesForSchedulerWindowInput): readonly ScheduledMidiNote[] {
    const { maxDurationBeats, orderByNote, sortedNotes } = getScheduledMidiNoteIndex(notes);
    const schedulerStartBeat = Math.max(fromBeat, lastScheduledBeat);
    const schedulesClipBoundary =
        iterationStartBeat >= fromBeat && iterationStartBeat < toBeat && iterationStartBeat >= lastScheduledBeat;
    const leadingIntervalLookbehindBeats = schedulesClipBoundary ? maxDurationBeats : 0;
    const sourceStartBeat =
        schedulerStartBeat -
        iterationStartBeat +
        midiOffsetBeats -
        MIDI_NOTE_GROOVE_LOOKAROUND_BEATS -
        leadingIntervalLookbehindBeats;
    const sourceEndBeat = toBeat - iterationStartBeat + midiOffsetBeats + MIDI_NOTE_GROOVE_LOOKAROUND_BEATS;
    const startIndex = lowerBoundMidiNoteStart(sortedNotes, sourceStartBeat);
    const endIndex = lowerBoundMidiNoteStart(sortedNotes, sourceEndBeat);
    const candidates = sortedNotes.slice(startIndex, endIndex);
    candidates.sort((left, right) => orderByNote.get(left)! - orderByNote.get(right)!);
    return candidates;
}

function selectYeastNotesForSchedulerWindow({
    notes,
    iterationStartBeat,
    fromBeat,
    toBeat,
}: SelectYeastNotesForSchedulerWindowInput): readonly ScheduledMidiNote[] {
    const { orderByNote, sortedNoteEnds, sortedNotes } = getScheduledMidiNoteIndex(notes);
    const sourceStartBeat = fromBeat - iterationStartBeat - MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
    const sourceEndBeat = toBeat - iterationStartBeat + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
    const startIndex = lowerBoundMidiNoteStart(sortedNotes, sourceStartBeat);
    const endIndex = lowerBoundMidiNoteStart(sortedNotes, sourceEndBeat);
    const noteEndStartIndex = lowerBoundMidiNoteEnd(sortedNoteEnds, sourceStartBeat);
    const noteEndEndIndex = lowerBoundMidiNoteEnd(sortedNoteEnds, sourceEndBeat);
    const candidates = new Set<ScheduledMidiNote>();
    for (let index = startIndex; index < endIndex; index++) {
        candidates.add(sortedNotes[index]!);
    }
    for (let index = noteEndStartIndex; index < noteEndEndIndex; index++) {
        candidates.add(sortedNoteEnds[index]!);
    }
    return [...candidates].sort((left, right) => orderByNote.get(left)! - orderByNote.get(right)!);
}

function getScheduledIterationRange({
    clipStartBeat,
    fromBeat,
    iterationCount,
    loopEnabled,
    loopLengthBeats,
    toBeat,
}: GetScheduledIterationRangeInput): ScheduledIterationRange {
    if (!loopEnabled) {
        return { startIndex: 0, endIndex: Math.min(1, iterationCount) };
    }
    const startIndex = Math.max(0, Math.floor((fromBeat - clipStartBeat) / loopLengthBeats));
    const endIndex = Math.min(iterationCount, Math.ceil((toBeat - clipStartBeat) / loopLengthBeats));
    return { startIndex: Math.min(startIndex, endIndex), endIndex };
}

function getYeastCandidateIterationRange({
    clipStartBeat,
    fromBeat,
    iterationCount,
    loopEnabled,
    loopLengthBeats,
    toBeat,
    notes,
}: GetScheduledIterationRangeInput & { notes: readonly ScheduledMidiNote[] }): ScheduledIterationRange {
    const activeRange = getScheduledIterationRange({
        clipStartBeat,
        fromBeat,
        iterationCount,
        loopEnabled,
        loopLengthBeats,
        toBeat,
    });
    if (!loopEnabled || notes.length === 0) {
        return activeRange;
    }
    const { maxEndpointBeat, minEndpointBeat } = getScheduledMidiNoteIndex(notes);
    const firstEndpointIndex = Math.max(
        0,
        Math.ceil((fromBeat - MAX_GROOVE_STAGE_DISPLACEMENT_BEATS - clipStartBeat - maxEndpointBeat) / loopLengthBeats)
    );
    const endpointEndIndex = Math.min(
        iterationCount,
        Math.ceil((toBeat + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS - clipStartBeat - minEndpointBeat) / loopLengthBeats)
    );
    return {
        startIndex: Math.min(activeRange.startIndex, firstEndpointIndex),
        endIndex: Math.max(activeRange.endIndex, endpointEndIndex),
    };
}

/**
 * The built-in synth's MPE params for a scheduled note, or `undefined` when the
 * note carries no expression at all.
 *
 * The bend range rides along only when there is a bend to interpret. A range on
 * a note that never bent describes nothing, the synth never reads it, and
 * emitting it anyway makes every exact-shape assertion downstream pin a
 * fallback instead of a decision (audit MD-8).
 */
function resolveScheduledMpeParams(note: ScheduledMpeParams): ScheduledMpeParams | undefined {
    const hasExpression = note.pressure !== undefined || note.slide !== undefined || note.pitchBend !== undefined;
    if (!hasExpression) {
        return undefined;
    }

    const params: ScheduledMpeParams = {
        pressure: note.pressure,
        slide: note.slide,
        pitchBend: note.pitchBend,
    };
    if (note.pitchBend !== undefined) {
        params.pitchBendRangeSemitones = note.pitchBendRangeSemitones ?? getDefaultBendRangeSemitones();
    }
    return params;
}

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
    const automationLanes = automationStore.value?.lanes ?? [];
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

        const windowMidiClips = selectMidiClipsForSchedulerWindow({ clips: track.clips, fromBeat, toBeat });
        if (windowMidiClips.length === 0) {
            continue;
        }

        const resolvedClips = resolveClipsWithComping(track.id, windowMidiClips);
        const activeMidiClips = resolvedClips.filter(
            (clip) => !clip.muted && clip.type === 'midi' && clip.endBeat > fromBeat && clip.startBeat < toBeat
        );
        if (activeMidiClips.length === 0) {
            continue;
        }

        const drumKitDef = resolveDrumKitDef(track.devices);
        const drumKit = drumKitDef ? null : resolveDrumKit(track.devices);
        const yeastDevice = track.devices.find((device) => device.type === 'yeast');
        const liveYeastIterations: LiveYeastIteration[] = [];
        let activeYeastCarrierRouteId: string | undefined;

        if (yeastDevice) {
            for (const clip of activeMidiClips) {
                const sourceNotes = midiState.notesByClipId[clip.id];
                if (!sourceNotes) {
                    continue;
                }

                const clipVisualLength = clip.endBeat - clip.startBeat;
                const loopProjection = projectClipLoopExpansion({
                    clipDurationBeats: clipVisualLength,
                    configuredLoopLengthBeats: clip.loopLength,
                    loopEnabled: clip.loopEnabled ?? false,
                });
                const loopLength = loopProjection.loopLengthBeats;
                const sourceOccurrenceOffset = getSourceOccurrenceOffset({
                    sourceStartBeat: clip.sourceStartBeat,
                    segmentStartBeat: clip.startBeat,
                    loopLength,
                    loopEnabled: clip.loopEnabled ?? false,
                });
                const iterationCount = loopProjection.iterationCount;
                const activeIterationRange = getScheduledIterationRange({
                    clipStartBeat: clip.startBeat,
                    fromBeat,
                    iterationCount,
                    loopEnabled: clip.loopEnabled ?? false,
                    loopLengthBeats: loopLength,
                    toBeat,
                });
                const candidateIterationRange = getYeastCandidateIterationRange({
                    clipStartBeat: clip.startBeat,
                    fromBeat,
                    iterationCount,
                    loopEnabled: clip.loopEnabled ?? false,
                    loopLengthBeats: loopLength,
                    notes: sourceNotes,
                    toBeat,
                });
                for (
                    let iteration = candidateIterationRange.startIndex;
                    iteration < candidateIterationRange.endIndex;
                    iteration++
                ) {
                    if (!isCurrent()) {
                        return;
                    }
                    const absoluteOccurrenceIndex = sourceOccurrenceOffset + iteration;
                    const iterationStartBeat = clip.startBeat + iteration * loopLength;
                    const iterationEndBeat = Math.min(iterationStartBeat + loopLength, clip.endBeat);
                    const routeId = `live-yeast:${track.id}:${clip.id}:${absoluteOccurrenceIndex}`;
                    const candidateNotes = selectYeastNotesForSchedulerWindow({
                        notes: sourceNotes,
                        iterationStartBeat,
                        fromBeat,
                        toBeat,
                    });
                    const isActiveIteration =
                        iteration >= activeIterationRange.startIndex && iteration < activeIterationRange.endIndex;
                    if (!isActiveIteration && candidateNotes.length === 0) {
                        continue;
                    }
                    const iterationDescriptor = {
                        routeId,
                        clipId: clip.id,
                        iterationStartBeat,
                        iterationEndBeat,
                        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
                        sourceNotes,
                    } satisfies LiveYeastIteration;
                    cancellation?.yeastRouteLineage.set(routeId, iterationDescriptor);
                    liveYeastIterations.push({
                        ...iterationDescriptor,
                        sourceNotes: candidateNotes.filter((note) =>
                            shouldPlayMidiEvent({
                                projectProbabilitySeed: midiState.probabilitySeed,
                                clipId: clip.id,
                                eventId: note.id,
                                absoluteOccurrenceIndex,
                                probabilityPercent: note.probability ?? 100,
                            })
                        ),
                    });
                    if (activeYeastCarrierRouteId === undefined && isActiveIteration) {
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
                routeLineage: cancellation?.yeastRouteLineage,
            });
            if (!yeastResult) {
                return;
            }
            for (const [routeId, routeNotes] of yeastResult.notesByRoute) {
                liveYeastNotesByRoute.set(routeId, routeNotes);
            }
            if (yeastResult.generatedNotes.length > 0) {
                for (const note of yeastResult.generatedNotes) {
                    const hasOriginCarrier = liveYeastIterations.some(
                        (iteration) =>
                            iteration.iterationStartBeat <= note.startBeat &&
                            note.startBeat < iteration.iterationEndBeat
                    );
                    if (!hasOriginCarrier) {
                        continue;
                    }
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

        for (const clip of activeMidiClips) {
            const notes = midiState.notesByClipId[clip.id];
            if (!notes) {
                continue;
            }

            const clipMidiOffset = clip.midiOffsetBeats ?? 0;
            const synthParams = drumKit || drumKitDef ? null : getSynthParamsForTrack(track.id);
            const compensation = getCompensationDelay(track.id);
            const clipVisualLength = clip.endBeat - clip.startBeat;
            const loopProjection = projectClipLoopExpansion({
                clipDurationBeats: clipVisualLength,
                configuredLoopLengthBeats: clip.loopLength,
                loopEnabled: clip.loopEnabled ?? false,
            });
            const loopLen = loopProjection.loopLengthBeats;
            const maxIterations = loopProjection.iterationCount;
            const scheduledIterationRange = getScheduledIterationRange({
                clipStartBeat: clip.startBeat,
                fromBeat,
                iterationCount: maxIterations,
                loopEnabled: clip.loopEnabled ?? false,
                loopLengthBeats: loopLen,
                toBeat,
            });
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
                getSwingOffsetBeats: (noteStartBeat: number) => number;
            } | null = null;
            let toasterOwnerTrack = track;
            let toasterDevice = track.devices.find((data) => data.type === 'toaster');
            let toasterPad = -1;
            if (track.parentId) {
                const toasterParentTrack = tracks.find((time1) => time1.id === track.parentId);
                const parentToasterDevice = toasterParentTrack?.devices.find((data) => data.type === 'toaster');
                if (toasterParentTrack && parentToasterDevice) {
                    toasterOwnerTrack = toasterParentTrack;
                    toasterDevice = parentToasterDevice;
                    let childIndex = 0;
                    for (const candidate of tracks) {
                        if (candidate.parentId === toasterParentTrack.id) {
                            if (candidate.id === track.id) {
                                toasterPad = childIndex;
                                break;
                            }
                            childIndex++;
                        }
                    }
                }
            }
            if (toasterDevice) {
                const toasterStrip = toasterOwnerTrack.id === track.id ? strip : ensureTrackStrip(toasterOwnerTrack.id);
                const deviceNode = toasterStrip.deviceNodes.find(
                    (data) => data.deviceId === toasterDevice.id || data.type === 'toaster'
                );
                if (deviceNode?.toasterControls) {
                    toasterRoute = {
                        controls: deviceNode.toasterControls,
                        pad: toasterPad,
                        getSwingOffsetBeats: (noteStartBeat) =>
                            getToasterSwingOffsetBeats({
                                parentTrackId: toasterOwnerTrack.id,
                                toasterDeviceId: toasterDevice.id,
                                automationMode: toasterOwnerTrack.automationMode,
                                devices: toasterOwnerTrack.devices,
                                lanes: automationLanes,
                                noteStartBeat,
                                evaluateAutomationValue: getAutomationValueAtBeat,
                                isAutomationRecording: isRecordingAutomation,
                                getCurrentSwingValue: (deviceId) =>
                                    toasterStore.value?.[deviceId]?.kit.swing ??
                                    toasterDevice.parameterValues.swing ??
                                    0,
                            }),
                    };
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

            // The `faust-` prefix is carried by every Faust module, effect or
            // instrument, so matching it took a MIDI track's notes into the
            // first Faust *effect* in the rack — freq/gain/gate written into a
            // reverb voice nothing. Because the branch below is an `else if`,
            // taking it also skipped the builtin-synth fallback, so such a
            // track was silent live while the export rendered the fallback:
            // offline picks its note target from `instrumentControls`, which
            // `buildDeviceChain` only attaches when the strategy declares
            // `acceptsNotes` — and `FaustDeviceStrategy` takes that from
            // `isFaustInstrumentModule`. Asking the same question here is what
            // keeps the two runtimes on the same device.
            const faustDevice =
                toasterRoute || drumKitDef || drumKit || workletSynthControls
                    ? null
                    : track.devices.find((data) => isFaustInstrumentModule(data.type));

            for (let iter = scheduledIterationRange.startIndex; iter < scheduledIterationRange.endIndex; iter++) {
                if (!isCurrent()) {
                    return;
                }
                const absoluteOccurrenceIndex = sourceOccurrenceOffset + iter;
                const iterOffset = iter * loopLen;
                const yeastRouteId = `live-yeast:${track.id}:${clip.id}:${absoluteOccurrenceIndex}`;
                let iterNotes: readonly LiveYeastNote[];
                if (yeastDevice) {
                    iterNotes = liveYeastNotesByRoute.get(yeastRouteId) ?? [];
                } else if (clip.loopEnabled) {
                    iterNotes = selectMidiNotesForLoopWindow({
                        notes,
                        iterationStartBeat: clip.startBeat + iterOffset,
                        loopLengthBeats: loopLen,
                        midiOffsetBeats: clipMidiOffset,
                        fromBeat,
                        toBeat,
                        lastScheduledBeat,
                        grooveLookaroundBeats: MIDI_NOTE_GROOVE_LOOKAROUND_BEATS,
                    });
                } else {
                    iterNotes = selectMidiNotesForSchedulerWindow({
                        notes,
                        iterationStartBeat: clip.startBeat + iterOffset,
                        midiOffsetBeats: clipMidiOffset,
                        fromBeat,
                        toBeat,
                        lastScheduledBeat,
                    });
                }
                const notesAreAbsolute = yeastDevice !== undefined;

                for (const note of iterNotes) {
                    if (!isCurrent()) {
                        return;
                    }
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
                        const unswungStartBeat = projectedNote.startBeat;
                        if (
                            unswungStartBeat < fromBeat ||
                            unswungStartBeat >= toBeat ||
                            unswungStartBeat < lastScheduledBeat
                        ) {
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

                        const swingOffsetBeats = toasterRoute?.getSwingOffsetBeats(unswungStartBeat) ?? 0;
                        const noteStartBeat = unswungStartBeat + swingOffsetBeats;
                        let pitch = note.pitch;
                        if (track.followChordTrack && !drumKitDef && !drumKit && !toasterRoute) {
                            const refChord = getChordAtBeat(clip.startBeat);
                            const targetChord = getChordAtBeat(noteStartBeat);
                            pitch = transposeForChordTrack(pitch, refChord, targetChord);
                        }

                        const iterationEndBeat = Math.min(iterationStart + loopLen, clip.endBeat);
                        const unswungEndBeat = isTrackScopedYeastNote
                            ? Math.min(unswungStartBeat + projectedNote.duration, iterationEndBeat)
                            : unswungStartBeat + projectedNote.duration;
                        const noteEndBeat = unswungEndBeat + swingOffsetBeats;
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
                            const pad = toasterRoute.pad >= 0 ? toasterRoute.pad : resolveToasterPadIndex(pitch);
                            if (pad !== null) {
                                const safeVelocity = projectedNote.velocity;
                                toasterRoute.controls.noteOn(pad, safeVelocity, TOASTER_NEUTRAL_MIDI_NOTE, sampleFrame);
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
                            const kitVoice = scheduleKitNote(
                                ctx,
                                strip.gainNode,
                                drumKit,
                                pitch,
                                time,
                                duration,
                                projectedNote.velocity,
                                noteGain
                            );
                            if (kitVoice) {
                                registerScheduledSource(kitVoice);
                            }
                        } else if (workletSynthControls && workletSynthEntry) {
                            const rawVel = projectedNote.velocity;
                            const vel = workletSynthEntry.velocityTransform
                                ? workletSynthEntry.velocityTransform(rawVel)
                                : rawVel;
                            const noteChannel = note.channel ?? 0;
                            const articulationId = workletSynthDevice
                                ? resolveMidiNoteArticulationId({
                                      deviceType: workletSynthDevice.type,
                                      articulation: projectedNote.articulation,
                                  })
                                : null;
                            if (workletSynthDevice?.type === 'levain' && workletSynthNode?.levainControls) {
                                workletSynthNode.levainControls.noteOn(
                                    pitch,
                                    vel,
                                    sampleFrame,
                                    noteChannel,
                                    articulationId ?? undefined
                                );
                            } else {
                                workletSynthControls.noteOn(pitch, vel, sampleFrame, noteChannel);
                            }
                            // The depth the bend was recorded at, and only when
                            // there is a bend. Absent on notes captured before
                            // RPN 0 was decoded, which resolves to the MPE
                            // member default — the range they were actually
                            // performed under (audit MD-8).
                            const noteBendRange = resolveScheduledMpeParams(note)?.pitchBendRangeSemitones;
                            // MPE per-note expression (audit MD-2). Same
                            // surface the live Web MIDI handlers call, at the
                            // note's own start frame so the worklet applies it
                            // to the voice this noteOn just started.
                            applyNoteExpression({
                                trackId: track.id,
                                note: pitch,
                                channel: noteChannel,
                                expression: {
                                    pressure: note.pressure,
                                    slide: note.slide,
                                    pitchBend: note.pitchBend,
                                },
                                sampleFrame,
                                bendRangeSemitones: noteBendRange,
                            });
                            // Grand Boule is the one worklet synth whose
                            // `noteOff` reads a release velocity in slot 3 and
                            // its member channel in slot 4; Fermenter, Levain
                            // and Crumbs take the channel in slot 3. The shared
                            // three-argument call put the channel index where
                            // the release dynamic goes and left the release
                            // unaddressed, so it silenced every voice at that
                            // pitch instead of the one held on that channel.
                            // All four control types accept three numbers, so
                            // the compiler had nothing to object to.
                            if (workletSynthDevice?.type === 'grand-boule' && workletSynthNode?.grandBouleControls) {
                                workletSynthNode.grandBouleControls.noteOff(
                                    pitch,
                                    endSampleFrame,
                                    undefined,
                                    noteChannel
                                );
                            } else {
                                workletSynthControls.noteOff(pitch, endSampleFrame, noteChannel);
                            }
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
                            // The built-in synth holds no range of its own; it
                            // bends by the depth the note was recorded at
                            // (audit MD-8).
                            const mpe = resolveScheduledMpeParams(note);
                            const synthVoice = scheduleNote(
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
                            // Built-in synth and kit voices are bare
                            // oscillators; nothing else holds their handle, so
                            // without this a stop or a panic leaves them ringing
                            // for the rest of their programmed duration (MD-6).
                            registerScheduledSource(synthVoice);
                        }
                    }
                }
            }
        }
    }
}
