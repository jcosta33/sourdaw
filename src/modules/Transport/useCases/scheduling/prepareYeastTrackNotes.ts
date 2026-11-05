import { getAudioContext } from '#/modules/AudioEngine/useCases';
import {
    frozenMidiTakeRepeats,
    projectFrozenMidiTakeWindow,
    selectMidiNotesForRecordingPass,
} from '#/modules/MIDI/stores';
import { projectCommittedGroove, shouldPlayMidiEvent } from '#/modules/MIDI/useCases';
import { isBeatInEnabledClipLoopWindow, resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { lowerBoundMidiNoteEnd, lowerBoundMidiNoteStart } from '../../services/midiNoteBounds';
import {
    getSourceOccurrenceOffset,
    MAX_GROOVE_STAGE_DISPLACEMENT_BEATS,
} from '../../services/midiSchedulerWindowGeometry';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

import { getScheduledMidiNoteIndex, type ScheduledMidiNote } from './getScheduledMidiNoteIndex';
import { processLiveYeastTrackBlock, type LiveYeastIteration, type LiveYeastNote } from './processLiveYeastTrackBlock';
import { resolveRawClipYeastPasses } from './resolveRawClipYeastPasses';
import { addYeastLoopPhaseCandidates } from './yeastLoopPhaseIndex';

import type { trackStore } from '#/modules/Arrangement/stores';
import type { MidiStoreState } from '#/modules/MIDI/stores';
import type { resolveMidiWindowClips } from './resolveMidiWindowClips';
import type { SchedulerCancellation } from './schedulerCancellation';
import type { TransportState } from '../../models/TransportState';
import type { tempoMapStore } from '../../stores/tempoMapStore';

type SchedulerTrack = NonNullable<(typeof trackStore)['value']>['tracks'][number];
type SelectYeastNotesForSchedulerWindowInput = {
    notes: readonly ScheduledMidiNote[];
    iterationStartBeat: number;
    midiOffsetBeats: number;
    loopEnabled: boolean;
    loopLengthBeats: number;
    /** The owning clip's start — not the iteration's; the anchor's trim advance reads against it. */
    clipStartBeat: number;
    loopOriginBeat: number | undefined;
    fromBeat: number;
    toBeat: number;
};
function selectYeastNotesForSchedulerWindow({
    notes,
    iterationStartBeat,
    midiOffsetBeats,
    loopEnabled,
    loopLengthBeats,
    clipStartBeat,
    loopOriginBeat,
    fromBeat,
    toBeat,
}: SelectYeastNotesForSchedulerWindowInput): readonly ScheduledMidiNote[] {
    const { maxDurationBeats, orderByNote, sortedNoteEnds, sortedNotes } = getScheduledMidiNoteIndex(notes);
    // #4655 — candidates live in content coordinates: the window's audible
    // span converts back with `+ midiOffsetBeats`, the same conversion
    // `selectMidiNotesForSchedulerWindow` performs. The boundary lookbehind
    // mirrors that selector too: content displaced before the iteration start
    // used to sound clamped to it, and only notes with `duration > offset −
    // content` survived the clamp, so `maxDurationBeats` covers every one of
    // them.
    const schedulesIterationBoundary = iterationStartBeat >= fromBeat && iterationStartBeat < toBeat;
    const leadingIntervalLookbehindBeats = schedulesIterationBoundary ? maxDurationBeats : 0;
    // The iteration opens on the anchor's pass grid, where the content's
    // offset-relative zero sounds the trim advance in.
    const contentZeroBeat =
        iterationStartBeat + resolveClipLoopOriginAdvance({ startBeat: clipStartBeat, loopOriginBeat, loopEnabled });
    const sourceStartBeat =
        fromBeat -
        contentZeroBeat +
        midiOffsetBeats -
        MAX_GROOVE_STAGE_DISPLACEMENT_BEATS -
        leadingIntervalLookbehindBeats;
    const sourceEndBeat = toBeat - contentZeroBeat + midiOffsetBeats + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
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
    if (loopEnabled && loopLengthBeats > 0) {
        // A looped pass also places notes away from their raw start: a start
        // wrapped from before the head, a tail struck on the head, and their
        // releases. The phase index finds those for this window.
        addYeastLoopPhaseCandidates({
            candidates,
            iterationStartBeat,
            fromBeat,
            toBeat,
            notes,
            loopLengthBeats,
            midiOffsetBeats,
            clipStartBeat,
            loopOriginBeat,
            loopEnabled,
        });
    }
    // #5198 — the loop window owns admission on the row's stored figure, the
    // same relative beat the synth path's selector and per-note test read: a
    // row past the trimmed region end, or stored at or past an anchorless
    // loop's length, is a content-window candidate here (its audible beat sits
    // inside the scheduler window) and must never reach the rack's ownership.
    return Array.from(candidates)
        .filter((note) =>
            isBeatInEnabledClipLoopWindow({
                relativeBeat: note.startBeat - midiOffsetBeats,
                startBeat: clipStartBeat,
                loopOriginBeat,
                loopLengthBeats,
                loopEnabled,
            })
        )
        .sort((left, right) => orderByNote.get(left)! - orderByNote.get(right)!);
}

function probableYeastNotes(
    notes: readonly ScheduledMidiNote[],
    midiState: MidiStoreState,
    clipId: string,
    absoluteOccurrenceIndex: number
): ScheduledMidiNote[] {
    return notes.filter((note) =>
        shouldPlayMidiEvent({
            projectProbabilitySeed: midiState.probabilitySeed,
            clipId,
            eventId: note.id,
            absoluteOccurrenceIndex,
            probabilityPercent: note.probability ?? 100,
        })
    );
}

function prepareFrozenClipYeastIterations(
    track: SchedulerTrack,
    clip: ReturnType<typeof resolveMidiWindowClips>[number],
    midiState: MidiStoreState,
    fromBeat: number,
    toBeat: number,
    cancellation: SchedulerCancellation | undefined,
    isCurrent: () => boolean,
    liveYeastIterations: LiveYeastIteration[]
): string | null | undefined {
    const frozenSource = clip.midiTakeSource;
    if (!frozenSource) {
        return undefined;
    }
    let activeYeastCarrierRouteId: string | undefined;
    const { loopLengthBeats } = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled: clip.loopEnabled ?? false,
    });
    // A frozen take counts its occurrences on its own grid, as live does.
    const sourceOccurrenceOffset = getSourceOccurrenceOffset({
        sourceStartBeat: clip.sourceStartBeat,
        segmentStartBeat: clip.startBeat,
        loopLength: loopLengthBeats,
        loopEnabled: clip.loopEnabled ?? false,
    });
    // Admits one repeat before the first that reaches the window.
    const repeats = frozenMidiTakeRepeats(frozenSource, clip, fromBeat - loopLengthBeats, toBeat);
    for (const repeat of repeats) {
        if (!isCurrent()) {
            return null;
        }
        const absoluteOccurrenceIndex = sourceOccurrenceOffset + repeat.absoluteOccurrenceIndex;
        const window = projectFrozenMidiTakeWindow({
            source: frozenSource,
            fragment: clip,
            recordingPassIndex: clip.midiTakeRecordingPassIndex,
            absoluteOccurrenceIndex: repeat.absoluteOccurrenceIndex,
            fromBeat: clip.startBeat,
            toBeat: clip.endBeat,
        });
        if (!window) {
            throw new Error('Invalid frozen MIDI take window');
        }
        const passStart = repeat.startBeat;
        const passEnd = Math.min(repeat.endBeat, clip.endBeat);
        const isActive = passStart < toBeat && passEnd > fromBeat;
        if (!isActive && window.notes.length === 0) {
            continue;
        }
        const routeId = `live-yeast:${track.id}:${clip.id}:${absoluteOccurrenceIndex}`;
        const sourceNotes = window.notes.map((note) => ({ ...note, startBeat: note.startBeat - passStart }));
        const descriptor = {
            routeId,
            clipId: frozenSource.sourceClipId,
            iterationStartBeat: passStart,
            iterationEndBeat: passEnd,
            midiOffsetBeats: 0,
            loopEnabled: false,
            loopLengthBeats: repeat.strideBeats,
            clipStartBeat: clip.startBeat,
            clipEndBeat: clip.endBeat,
            sourceNotes,
        } satisfies LiveYeastIteration;
        cancellation?.yeastRouteLineage.set(routeId, descriptor);
        liveYeastIterations.push({
            ...descriptor,
            sourceNotes: probableYeastNotes(sourceNotes, midiState, frozenSource.sourceClipId, absoluteOccurrenceIndex),
        });
        if (activeYeastCarrierRouteId === undefined && isActive) {
            activeYeastCarrierRouteId = routeId;
        }
    }
    return activeYeastCarrierRouteId;
}

function prepareRawClipYeastIterations(
    track: SchedulerTrack,
    clip: ReturnType<typeof resolveMidiWindowClips>[number],
    midiState: MidiStoreState,
    fromBeat: number,
    toBeat: number,
    cancellation: SchedulerCancellation | undefined,
    isCurrent: () => boolean,
    liveYeastIterations: LiveYeastIteration[]
): string | null | undefined {
    let activeYeastCarrierRouteId: string | undefined;
    const sourceNotes = selectMidiNotesForRecordingPass(
        midiState.notesByClipId[clip.id] ?? [],
        clip.midiTakeRecordingPassIndex
    );

    const { loopLength, firstPassStartBeat, sourceOccurrenceOffset, activeIterationRange, candidateIterationRange } =
        resolveRawClipYeastPasses({ clip, sourceNotes, fromBeat, toBeat });
    for (
        let iteration = candidateIterationRange.startIndex;
        iteration < candidateIterationRange.endIndex;
        iteration++
    ) {
        if (!isCurrent()) {
            return null;
        }
        const absoluteOccurrenceIndex = sourceOccurrenceOffset + iteration;
        const iterationStartBeat = firstPassStartBeat + iteration * loopLength;
        const iterationEndBeat = Math.min(iterationStartBeat + loopLength, clip.endBeat);
        const routeId = `live-yeast:${track.id}:${clip.id}:${absoluteOccurrenceIndex}`;
        const candidateNotes = selectYeastNotesForSchedulerWindow({
            notes: sourceNotes,
            iterationStartBeat,
            midiOffsetBeats: clip.midiOffsetBeats ?? 0,
            loopEnabled: clip.loopEnabled ?? false,
            loopLengthBeats: loopLength,
            clipStartBeat: clip.startBeat,
            loopOriginBeat: clip.loopOriginBeat,
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
            loopEnabled: clip.loopEnabled ?? false,
            loopLengthBeats: loopLength,
            clipStartBeat: clip.startBeat,
            loopOriginBeat: clip.loopOriginBeat,
            clipEndBeat: clip.endBeat,
            sourceNotes,
        } satisfies LiveYeastIteration;
        cancellation?.yeastRouteLineage.set(routeId, iterationDescriptor);
        liveYeastIterations.push({
            ...iterationDescriptor,
            sourceNotes: probableYeastNotes(candidateNotes, midiState, clip.id, absoluteOccurrenceIndex),
        });
        if (activeYeastCarrierRouteId === undefined && isActiveIteration) {
            activeYeastCarrierRouteId = routeId;
        }
    }
    return activeYeastCarrierRouteId;
}

function prepareClipYeastIterations(
    track: SchedulerTrack,
    clip: ReturnType<typeof resolveMidiWindowClips>[number],
    midiState: MidiStoreState,
    fromBeat: number,
    toBeat: number,
    cancellation: SchedulerCancellation | undefined,
    isCurrent: () => boolean,
    liveYeastIterations: LiveYeastIteration[]
): string | null | undefined {
    const prepare = clip.midiTakeSource ? prepareFrozenClipYeastIterations : prepareRawClipYeastIterations;
    return prepare(track, clip, midiState, fromBeat, toBeat, cancellation, isCurrent, liveYeastIterations);
}

function appendGeneratedYeastNotes(
    generatedNotes: readonly LiveYeastNote[],
    liveYeastIterations: readonly LiveYeastIteration[],
    liveYeastNotesByRoute: Map<string, LiveYeastNote[]>,
    trackScopedYeastNoteIds: Set<string>
): void {
    for (const note of generatedNotes) {
        const hasOriginCarrier = liveYeastIterations.some(
            (iteration) => iteration.iterationStartBeat <= note.startBeat && note.startBeat < iteration.iterationEndBeat
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

export async function prepareYeastTrackNotes(
    track: SchedulerTrack,
    activeMidiClips: ReturnType<typeof resolveMidiWindowClips>,
    midiState: MidiStoreState,
    fromBeat: number,
    toBeat: number,
    changes: NonNullable<typeof tempoMapStore.value>['changes'],
    transport: TransportState,
    cancellation?: SchedulerCancellation
) {
    const isCurrent = cancellation?.isCurrent ?? (() => true);
    const yeastDevice = track.devices.find((device) => device.type === 'yeast');
    const liveYeastIterations: LiveYeastIteration[] = [];
    let activeYeastCarrierRouteId: string | undefined;

    if (yeastDevice) {
        for (const clip of activeMidiClips) {
            const activeRoute = prepareClipYeastIterations(
                track,
                clip,
                midiState,
                fromBeat,
                toBeat,
                cancellation,
                isCurrent,
                liveYeastIterations
            );
            if (activeRoute === null) {
                return null;
            }
            if (activeYeastCarrierRouteId === undefined) {
                activeYeastCarrierRouteId = activeRoute;
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
            return null;
        }
        for (const [routeId, routeNotes] of yeastResult.notesByRoute) {
            liveYeastNotesByRoute.set(routeId, routeNotes);
        }
        if (yeastResult.generatedNotes.length > 0) {
            appendGeneratedYeastNotes(
                yeastResult.generatedNotes,
                liveYeastIterations,
                liveYeastNotesByRoute,
                trackScopedYeastNoteIds
            );
        }
    }
    return { yeastDevice, liveYeastNotesByRoute, trackScopedYeastNoteIds };
}

export type PreparedYeastTrackNotes = NonNullable<Awaited<ReturnType<typeof prepareYeastTrackNotes>>>;
