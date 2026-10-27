import { getAudioContext } from '#/modules/AudioEngine/useCases';
import { projectCommittedGroove, shouldPlayMidiEvent } from '#/modules/MIDI/useCases';
import { isBeatAdmittedByAnchoredClipLoopWindow } from '#/utils/clipLoopOrigin';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import {
    getScheduledMidiNoteIndex,
    lowerBoundMidiNoteEnd,
    lowerBoundMidiNoteStart,
    type ScheduledMidiNote,
} from '../../services/midiNoteWindowIndex';
import {
    getScheduledIterationRange,
    getSourceOccurrenceOffset,
    MAX_GROOVE_STAGE_DISPLACEMENT_BEATS,
    type GetScheduledIterationRangeInput,
    type ScheduledIterationRange,
} from '../../services/midiSchedulerWindowGeometry';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

import { processLiveYeastTrackBlock, type LiveYeastIteration, type LiveYeastNote } from './processLiveYeastTrackBlock';

import type { trackStore } from '#/modules/Arrangement/stores';
import type { MidiStoreState } from '#/modules/MIDI/stores';
import type { resolveMidiWindowClips } from './resolveMidiWindowClips';
import type { SchedulerCancellation } from './scheduleMidiNotes';
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
type YeastLoopPhaseEntry = {
    endPhaseBeat: number;
    note: ScheduledMidiNote;
    phaseBeat: number;
};
type YeastLoopPhaseIndex = {
    clipStartBeat: number;
    loopEnabled: boolean;
    loopLengthBeats: number;
    loopOriginBeat: number | undefined;
    midiOffsetBeats: number;
    orderByNote: ReadonlyMap<ScheduledMidiNote, number>;
    sortedEnds: readonly YeastLoopPhaseEntry[];
    sortedEntries: readonly YeastLoopPhaseEntry[];
};
// Same invalidation rule for the looped-iteration phase view below.
const yeastLoopPhaseIndexes = new WeakMap<readonly ScheduledMidiNote[], YeastLoopPhaseIndex>();

function positiveModulo(value: number, divisor: number): number {
    return ((value % divisor) + divisor) % divisor;
}

function lowerBoundYeastLoopPhase(entries: readonly YeastLoopPhaseEntry[], phaseBeat: number): number {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (entries[middle]!.phaseBeat < phaseBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

function lowerBoundYeastLoopEnd(entries: readonly YeastLoopPhaseEntry[], endPhaseBeat: number): number {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = low + Math.floor((high - low) / 2);
        if (entries[middle]!.endPhaseBeat < endPhaseBeat) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
}

/**
 * Phase view of the content a looped iteration wraps: the class the ownership
 * re-anchors with the twin's positive modulo instead of clamping — starts
 * already before the iteration head, plus starts within one groove stage's
 * displacement after it, which the clip groove can pull across the head
 * (`MAX_GROOVE_STAGE_DISPLACEMENT_BEATS` bounds that displacement; the twin
 * grooves each candidate first and re-anchors only what lands before the head,
 * so a note pulled back inside sounds un-wrapped, and a raw start in
 * `[0, displacement)` indexes at its own position — the phase window's groove
 * slack is what reaches it from the late phase the twin anchors it to). Notes
 * are indexed by their wrapped position (`phaseBeat`) and wrapped release
 * (`endPhaseBeat`). The release stays uncapped: a note longer than its loop
 * rings past the iteration end and the owning window follows the release, as
 * the loop-work bounds spec pins. A start in `[0, displacement)` carries a
 * second release entry one loop past its phase — only the groove can wrap it,
 * and the wrapped release then rings a loop past the raw `endPhaseBeat`.
 */
function getYeastLoopPhaseIndex({
    notes,
    loopLengthBeats,
    midiOffsetBeats,
    clipStartBeat,
    loopOriginBeat,
    loopEnabled,
}: Pick<
    SelectYeastNotesForSchedulerWindowInput,
    'notes' | 'loopLengthBeats' | 'midiOffsetBeats' | 'clipStartBeat' | 'loopOriginBeat' | 'loopEnabled'
>): YeastLoopPhaseIndex {
    const cached = yeastLoopPhaseIndexes.get(notes);
    if (
        cached?.loopLengthBeats === loopLengthBeats &&
        cached.midiOffsetBeats === midiOffsetBeats &&
        cached.clipStartBeat === clipStartBeat &&
        cached.loopOriginBeat === loopOriginBeat &&
        cached.loopEnabled === loopEnabled
    ) {
        return cached;
    }

    const orderByNote = new Map<ScheduledMidiNote, number>();
    const sortedEntries: YeastLoopPhaseEntry[] = [];
    const sortedEnds: YeastLoopPhaseEntry[] = [];
    for (let index = 0; index < notes.length; index++) {
        const note = notes[index]!;
        orderByNote.set(note, index);
        const relativeStartBeat = note.startBeat - midiOffsetBeats;
        // Membership mirrors the twin's wrap class on both sides of the head: a
        // start already before it re-anchors as-is, and a start up to one groove
        // stage after it can be displaced across by the clip groove — the twin
        // then re-anchors the displaced start to the iteration's late phase, so
        // the note must be a phase-index candidate for that window.
        if (relativeStartBeat >= MAX_GROOVE_STAGE_DISPLACEMENT_BEATS) {
            continue;
        }
        // #5198 — the anchored loop window is the index's membership too: a row
        // past the trimmed region end never sounds on any pass, so it must not
        // enter the index the looped windows read. An unanchored clip keeps the
        // pre-anchor index — the admission helper admits without a test there.
        if (
            !isBeatAdmittedByAnchoredClipLoopWindow({
                relativeBeat: relativeStartBeat,
                startBeat: clipStartBeat,
                loopOriginBeat,
                loopLengthBeats,
                loopEnabled,
            })
        ) {
            continue;
        }
        const phaseBeat = positiveModulo(relativeStartBeat, loopLengthBeats);
        const entry = { endPhaseBeat: phaseBeat + note.duration, note, phaseBeat };
        sortedEntries.push(entry);
        sortedEnds.push(entry);
        if (relativeStartBeat >= 0) {
            // The groove-crossing class sounds un-wrapped only while the groove
            // leaves the start on the head's near side; when it pulls the start
            // across, ownership re-anchors it a full loop later and the release
            // rings at `wrappedStart + duration`, past this entry's
            // `endPhaseBeat`. Index that wrapped release too: it lands within
            // one groove stage of `phaseBeat + loopLengthBeats + duration`,
            // exactly the slack the release window already spends, so the
            // window owning the wrapped release still finds the note here.
            sortedEnds.push({
                endPhaseBeat: phaseBeat + loopLengthBeats + note.duration,
                note,
                phaseBeat,
            });
        }
    }
    sortedEntries.sort(
        (left, right) => left.phaseBeat - right.phaseBeat || orderByNote.get(left.note)! - orderByNote.get(right.note)!
    );
    const created = {
        clipStartBeat,
        loopEnabled,
        loopLengthBeats,
        loopOriginBeat,
        midiOffsetBeats,
        orderByNote,
        sortedEnds: sortedEnds.sort((left, right) => left.endPhaseBeat - right.endPhaseBeat),
        sortedEntries,
    };
    yeastLoopPhaseIndexes.set(notes, created);
    return created;
}

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
    const sourceStartBeat =
        fromBeat -
        iterationStartBeat +
        midiOffsetBeats -
        MAX_GROOVE_STAGE_DISPLACEMENT_BEATS -
        leadingIntervalLookbehindBeats;
    const sourceEndBeat = toBeat - iterationStartBeat + midiOffsetBeats + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
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
        // A looped iteration wraps a start displaced before its head into the
        // iteration — the twin's `((offset % loopLength) + loopLength) %
        // loopLength` re-anchor — so those notes are also selected by their
        // wrapped phase. Membership covers the groove too: a raw start within
        // `MAX_GROOVE_STAGE_DISPLACEMENT_BEATS` of the head is indexed on both
        // sides of it, and the phase window's own groove slack reaches the note
        // from the window that owns its displaced start. The window normalizes
        // into loop phase and may itself straddle the seam; the release query
        // stays unnormalized because a wrapped release rings past the iteration
        // end.
        const loopIndex = getYeastLoopPhaseIndex({
            notes,
            loopLengthBeats,
            midiOffsetBeats,
            clipStartBeat,
            loopOriginBeat,
            loopEnabled,
        });
        const phaseStartBeat = fromBeat - iterationStartBeat - MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
        const phaseEndBeat = toBeat - iterationStartBeat + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS;
        const phaseWidthBeats = phaseEndBeat - phaseStartBeat;
        if (phaseWidthBeats >= loopLengthBeats) {
            for (const { note } of loopIndex.sortedEntries) {
                candidates.add(note);
            }
        } else {
            const normalizedStartBeat = positiveModulo(phaseStartBeat, loopLengthBeats);
            const normalizedEndBeat = normalizedStartBeat + phaseWidthBeats;
            const phaseStartIndex = lowerBoundYeastLoopPhase(loopIndex.sortedEntries, normalizedStartBeat);
            if (normalizedEndBeat <= loopLengthBeats) {
                const phaseEndIndex = lowerBoundYeastLoopPhase(loopIndex.sortedEntries, normalizedEndBeat);
                for (let index = phaseStartIndex; index < phaseEndIndex; index++) {
                    candidates.add(loopIndex.sortedEntries[index]!.note);
                }
            } else {
                const wrappedEndIndex = lowerBoundYeastLoopPhase(
                    loopIndex.sortedEntries,
                    normalizedEndBeat - loopLengthBeats
                );
                for (let index = phaseStartIndex; index < loopIndex.sortedEntries.length; index++) {
                    candidates.add(loopIndex.sortedEntries[index]!.note);
                }
                for (let index = 0; index < wrappedEndIndex; index++) {
                    candidates.add(loopIndex.sortedEntries[index]!.note);
                }
            }
        }
        const releaseStartIndex = lowerBoundYeastLoopEnd(loopIndex.sortedEnds, phaseStartBeat);
        const releaseEndIndex = lowerBoundYeastLoopEnd(loopIndex.sortedEnds, phaseEndBeat);
        for (let index = releaseStartIndex; index < releaseEndIndex; index++) {
            candidates.add(loopIndex.sortedEnds[index]!.note);
        }
    }
    // #5198 — the anchored loop window owns admission on the row's stored
    // figure, the same relative beat the synth path's selector and per-note
    // test read: a row past the trimmed region end is a content-window
    // candidate here (its audible beat sits inside the scheduler window) and
    // must never reach the rack's ownership. An unanchored clip admits
    // without the test, byte-identically to the pre-anchor selector.
    return Array.from(candidates)
        .filter((note) =>
            isBeatAdmittedByAnchoredClipLoopWindow({
                relativeBeat: note.startBeat - midiOffsetBeats,
                startBeat: clipStartBeat,
                loopOriginBeat,
                loopLengthBeats,
                loopEnabled,
            })
        )
        .sort((left, right) => orderByNote.get(left)! - orderByNote.get(right)!);
}

function getYeastCandidateIterationRange({
    clipStartBeat,
    fromBeat,
    iterationCount,
    loopEnabled,
    loopLengthBeats,
    midiOffsetBeats,
    toBeat,
    notes,
}: GetScheduledIterationRangeInput & {
    midiOffsetBeats: number;
    notes: readonly ScheduledMidiNote[];
}): ScheduledIterationRange {
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
    const { maxDurationBeats, maxEndpointBeat } = getScheduledMidiNoteIndex(notes);
    // #4655 — endpoints are content beats; their audible position inside an
    // iteration is the offset-relative start, wrapped into the iteration when
    // it slips before the head. A looped iteration therefore owns note-ons up
    // to `max(loopLength, widest positive reach)` past its start, and a
    // wrapped note rings its release that far plus its duration, so the range
    // widens backwards by both and forwards only while the iteration start
    // still precedes the window.
    const latestOwnedOffsetBeats = Math.max(loopLengthBeats, maxEndpointBeat - midiOffsetBeats);
    const firstEndpointIndex = Math.max(
        0,
        Math.ceil(
            (fromBeat -
                MAX_GROOVE_STAGE_DISPLACEMENT_BEATS -
                clipStartBeat -
                latestOwnedOffsetBeats -
                maxDurationBeats) /
                loopLengthBeats
        )
    );
    const endpointEndIndex = Math.min(
        iterationCount,
        Math.floor((toBeat + MAX_GROOVE_STAGE_DISPLACEMENT_BEATS - clipStartBeat) / loopLengthBeats) + 1
    );
    return {
        startIndex: Math.min(activeRange.startIndex, firstEndpointIndex),
        endIndex: Math.max(activeRange.endIndex, endpointEndIndex),
    };
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
    let activeYeastCarrierRouteId: string | undefined;
    const sourceNotes = midiState.notesByClipId[clip.id] ?? [];

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
        midiOffsetBeats: clip.midiOffsetBeats ?? 0,
        notes: sourceNotes,
        toBeat,
    });
    for (
        let iteration = candidateIterationRange.startIndex;
        iteration < candidateIterationRange.endIndex;
        iteration++
    ) {
        if (!isCurrent()) {
            return null;
        }
        const absoluteOccurrenceIndex = sourceOccurrenceOffset + iteration;
        const iterationStartBeat = clip.startBeat + iteration * loopLength;
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
