import { type MidiNote } from '#/modules/MIDI/stores';
import { projectCommittedGroove } from '#/modules/MIDI/useCases';
import { isBeatInEnabledClipLoopWindow, resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
import {
    LOOP_PASS_GROOVE_INSTANCE_SUFFIX,
    LOOP_PASS_OVERFLOW_INSTANCE_SUFFIX,
    loopPassGrooveDisplacedNoteStartBeat,
    loopPassNoteEndBeat,
    loopPassNoteOverflowBeats,
    loopPassProducedNoteStartBeat,
    loopPassSourceInstanceId,
} from '#/utils/loopPassNoteSegments';

import {
    beatToSamples,
    getTempoAtBeat,
    samplesToBeat,
    splitRangeAtTempoChanges,
    type TempoChange,
} from '../../models/TempoMap';
import { getBarBeatAtPosition, getTimeSignatureAtBeat, type TimeSignatureChange } from '../../models/TimeSignatureMap';
import { type TransportState } from '../../models/TransportState';

import { liveMidiProcessor, type LiveMidiProcessorEvent } from './liveMidiProcessor';

export type LiveYeastNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    /** Semitone range `pitchBend` was performed against; absent means ±48 (audit MD-8). */
    pitchBendRangeSemitones?: number;
    channel?: number;
    /** Recorded curves; carried only to a note Yeast plays from this note's own instance. */
    expression?: MidiNote['expression'];
    /**
     * How far into its note this one begins when the clip's head cut it off before Yeast saw it; the note's
     * recorded expression curves count from the uncut start. Absent when nothing was cut.
     */
    beatsIntoNote?: number;
    /** Set on a segment the project groove moved out of its pass, placed before the rack; the groove is not applied again. */
    sequencerGrooveApplied?: boolean;
    articulation?: string;
    sourceEventId?: string;
    noteInstanceId?: string;
};

export type LiveYeastIteration = {
    routeId: string;
    clipId: string;
    iterationStartBeat: number;
    iterationEndBeat: number;
    midiOffsetBeats: number;
    /** Loop geometry of the owning clip; a descriptor without it never wraps. */
    loopEnabled?: boolean;
    loopLengthBeats?: number;
    /**
     * The owning clip's start and loop anchor (#5198); the membership window
     * reads its trim advance against both. A descriptor without them predates
     * the anchor and admits without the window, the pre-anchor behavior.
     */
    clipStartBeat?: number;
    loopOriginBeat?: number;
    sourceNotes: readonly LiveYeastNote[];
};

type ProcessLiveYeastTrackBlockInput = {
    context: BaseAudioContext;
    rackId: string;
    trackId: string;
    iterations: readonly LiveYeastIteration[];
    fromBeat: number;
    toBeat: number;
    changes: readonly TempoChange[];
    timeSignatureChanges: TimeSignatureChange[];
    transport: TransportState;
    discontinuityEpoch?: number;
    isCurrent: () => boolean;
    routeLineage?: ReadonlyMap<string, LiveYeastIteration>;
};

type ProcessLiveYeastTrackBlockOutput = {
    notesByRoute: Map<string, LiveYeastNote[]>;
    generatedNotes: LiveYeastNote[];
};

type PendingLiveYeastNote = {
    indices: number[];
    cursor: number;
};

type PendingIdentifiedLiveYeastNote = {
    notes: LiveYeastNote[];
    index: number;
};

/** One note a pass hands the rack: a segment of a source note, by its own instance. */
type LivePassSegment = {
    instanceId: string;
    startBeat: number;
    endBeat: number;
    velocity: number;
    /** How far into its source note the segment begins. */
    headCutBeats: number;
    /** Set when the project groove was applied before the rack; it is not applied again. */
    sequencerGrooveApplied?: boolean;
};

type LivePassGeometry = {
    noteId: string;
    passStartBeat: number;
    loopLengthBeats: number;
    clipHeadBeat: number | undefined;
};

type LiveSegmentEventContext = {
    block: { fromBeat: number; toBeat: number };
    changes: readonly TempoChange[];
    transport: TransportState;
    sampleRate: number;
    routeId: string;
    channel: number;
    pitch: number;
    /** The note-on's duration when the pass does not loop; a looped segment's is its own length. */
    durationPpq: number | undefined;
};

/** A head off the grid opens the first pass before the clip does; the clip head cuts what that pass places ahead of it. */
function cutLiveSegmentAtClipHead(segment: LivePassSegment, clipHeadBeat: number | undefined): LivePassSegment {
    const cutBeats = clipHeadBeat === undefined ? 0 : Math.max(0, clipHeadBeat - segment.startBeat);
    return { ...segment, startBeat: segment.startBeat + cutBeats, headCutBeats: segment.headCutBeats + cutBeats };
}

/**
 * The pass segment as the rack is handed it. Where the project groove would
 * move its start out of its pass (`loopPassGrooveDisplacedNoteStartBeat`),
 * the segment is placed where the loop puts it, grooved, and what then rings
 * past the pass end is its own note struck on the pass head. The project
 * groove follows the rack, and by the time the rack returns this note the
 * windows of its pass may have played the beat it lands on, so the placement
 * happens before the rack, where the window holding each landing owns it, as
 * the bounce places it. Otherwise the segment is handed on unchanged.
 */
function placeProjectGrooveDisplacement(
    segment: LivePassSegment,
    { noteId, passStartBeat, loopLengthBeats, clipHeadBeat }: LivePassGeometry
): LivePassSegment[] {
    const [groovedNote] = projectCommittedGroove({
        events: [{ id: noteId, startBeat: segment.startBeat, velocity: segment.velocity }],
        consumerType: 'sequencer',
        consumerId: 'project',
    });
    const displacedStartBeat =
        groovedNote && loopPassGrooveDisplacedNoteStartBeat(groovedNote.startBeat, passStartBeat, loopLengthBeats);
    if (!groovedNote || displacedStartBeat === undefined) {
        return [segment];
    }
    const durationBeats = segment.endBeat - segment.startBeat;
    const displacedEndBeat = loopPassNoteEndBeat(displacedStartBeat, durationBeats, passStartBeat, loopLengthBeats);
    const overflowBeats = loopPassNoteOverflowBeats(displacedStartBeat, durationBeats, passStartBeat, loopLengthBeats);
    const displacedInstanceId = `${segment.instanceId}${LOOP_PASS_GROOVE_INSTANCE_SUFFIX}`;
    const placedSegments = [
        cutLiveSegmentAtClipHead(
            {
                instanceId: displacedInstanceId,
                startBeat: displacedStartBeat,
                endBeat: displacedEndBeat,
                velocity: groovedNote.velocity,
                headCutBeats: segment.headCutBeats,
                sequencerGrooveApplied: true,
            },
            clipHeadBeat
        ),
    ];
    if (overflowBeats > 0) {
        placedSegments.push(
            cutLiveSegmentAtClipHead(
                {
                    instanceId: `${displacedInstanceId}${LOOP_PASS_OVERFLOW_INSTANCE_SUFFIX}`,
                    startBeat: passStartBeat,
                    endBeat: passStartBeat + overflowBeats,
                    velocity: groovedNote.velocity,
                    headCutBeats: segment.headCutBeats + displacedEndBeat - displacedStartBeat,
                    sequencerGrooveApplied: true,
                },
                clipHeadBeat
            )
        );
    }
    return placedSegments;
}

/** Records what the rack's output needs to know of a segment's instance: the cut it begins with, and a groove already applied. */
function recordLiveSegmentInstance(
    { instanceId, headCutBeats, sequencerGrooveApplied }: LivePassSegment,
    headCutBeatsByInstance: Map<string, number>,
    sequencerGroovedInstances: Set<string>
): void {
    if (headCutBeats > 0) {
        headCutBeatsByInstance.set(instanceId, headCutBeats);
    }
    if (sequencerGrooveApplied === true) {
        sequencerGroovedInstances.add(instanceId);
    }
}

/** Hands the rack the segment's note-on and note-off this block owns: each one whose beat lies in `[from, to)`. */
function pushLiveSegmentEvents(
    inputEvents: LiveMidiProcessorEvent[],
    { instanceId, startBeat, endBeat, velocity }: LivePassSegment,
    { block, changes, transport, sampleRate, routeId, channel, pitch, durationPpq }: LiveSegmentEventContext
): void {
    const noteStartSamples = beatToSamples(changes, startBeat, transport.tempo, sampleRate);
    const noteEndSamples = beatToSamples(changes, endBeat, transport.tempo, sampleRate);
    if (startBeat >= block.fromBeat && startBeat < block.toBeat) {
        inputEvents.push({
            timeSamples: noteStartSamples,
            durationSamples: Math.max(0, noteEndSamples - noteStartSamples),
            durationPpq: durationPpq ?? endBeat - startBeat,
            trackId: routeId,
            sourceEventId: `${instanceId}:on`,
            noteInstanceId: instanceId,
            timePpq: startBeat,
            tempoBpm: getTempoAtBeat(changes, startBeat, transport.tempo),
            kind: { type: 'noteOn', channel, note: pitch, velocity },
        });
    }
    if (endBeat >= block.fromBeat && endBeat < block.toBeat) {
        inputEvents.push({
            timeSamples: noteEndSamples,
            trackId: routeId,
            sourceEventId: `${instanceId}:off`,
            noteInstanceId: instanceId,
            timePpq: endBeat,
            tempoBpm: getTempoAtBeat(changes, endBeat, transport.tempo),
            kind: { type: 'noteOff', channel, note: pitch },
        });
    }
}

export async function processLiveYeastTrackBlock({
    context,
    rackId,
    trackId,
    iterations,
    fromBeat,
    toBeat,
    changes,
    timeSignatureChanges,
    transport,
    discontinuityEpoch,
    isCurrent,
    routeLineage,
}: ProcessLiveYeastTrackBlockInput): Promise<ProcessLiveYeastTrackBlockOutput | null> {
    const sampleRate = context.sampleRate;
    const tempoMap = {
        defaultTempo: transport.tempo,
        changes: changes
            .map(({ beat, tempo, curve }) => ({ beat, tempo, curve }))
            .sort((alpha, beta) => alpha.beat - beta.beat),
    };
    const processor = liveMidiProcessor.read('processLiveYeastTrackBlock');
    const processedEvents: LiveMidiProcessorEvent[] = [];
    // The beats of a note the clip's head cut off before Yeast saw it, by note instance: the notes Yeast plays
    // from that instance begin that far into the note they came from.
    const headCutBeatsByInstance = new Map<string, number>();
    // The note instances the project groove already placed before the rack.
    const sequencerGroovedInstances = new Set<string>();

    for (const block of splitRangeAtTempoChanges(changes, fromBeat, toBeat)) {
        if (!isCurrent()) {
            return null;
        }

        const blockTempo = getTempoAtBeat(changes, block.fromBeat, transport.tempo);
        const barBeat = getBarBeatAtPosition(
            timeSignatureChanges,
            block.fromBeat,
            transport.timeSignatureNumerator,
            transport.timeSignatureDenominator
        );
        const blockTimeSignature = getTimeSignatureAtBeat(
            timeSignatureChanges,
            block.fromBeat,
            transport.timeSignatureNumerator,
            transport.timeSignatureDenominator
        );
        const inputEvents: LiveMidiProcessorEvent[] = [];

        for (const iteration of iterations) {
            for (const sourceNote of iteration.sourceNotes) {
                // #5198 — the loop window owns membership on the row's stored
                // figure, the same relative beat the synth path's admission
                // reads: a row past the trimmed region end, or stored at or
                // past an anchorless loop's length, stays silent on every pass
                // even though the wrap below would re-anchor it into the
                // iteration. A descriptor without the
                // clip's anchor pair predates the field and admits without the
                // window, exactly as before the anchor existed.
                if (
                    iteration.clipStartBeat !== undefined &&
                    !isBeatInEnabledClipLoopWindow({
                        relativeBeat: sourceNote.startBeat - iteration.midiOffsetBeats,
                        startBeat: iteration.clipStartBeat,
                        loopOriginBeat: iteration.loopOriginBeat,
                        loopLengthBeats: iteration.loopLengthBeats ?? 0,
                        loopEnabled: iteration.loopEnabled === true,
                    })
                ) {
                    continue;
                }
                const [groovedNote] = projectCommittedGroove({
                    events: [sourceNote],
                    consumerType: 'clip',
                    consumerId: iteration.clipId,
                });
                if (!groovedNote) {
                    continue;
                }

                // #4655 — own the note at its audible beat, the same coordinate
                // every other path uses: `iterationStartBeat + startBeat −
                // midiOffsetBeats`, plus the trim advance on the anchor's pass
                // grid. The offset locates the content inside the clip;
                // selecting and owning on the un-offset beat and shifting back
                // afterwards dropped every note whose offset was wider than one
                // scheduler window. A non-looped clip clamps a displaced start
                // to the iteration start — the boundary clamp
                // `projectClipMidiEvents` applies — and keeps its original end.
                //
                // A looped pass plays the note as every route segments it
                // (`loopPassNoteSegments`): a start before the head re-anchors
                // by the loop, the note keeps at most one loop of its length and
                // ends at the pass end, and the part that would ring past the
                // pass end is handed to the rack as its own note, struck on the
                // pass head. A live window cannot see a note-on later in its
                // pass, so a tail wrapped onto the head after the rack sounded
                // only when one window spanned both the head and the note's
                // start; as its own note-on it is owned by the window holding
                // the head, whatever windows the timeline is cut into.
                const loopLengthBeats = iteration.loopLengthBeats ?? 0;
                const loopAdvanceBeats =
                    iteration.clipStartBeat === undefined
                        ? 0
                        : resolveClipLoopOriginAdvance({
                              startBeat: iteration.clipStartBeat,
                              loopOriginBeat: iteration.loopOriginBeat,
                              loopEnabled: iteration.loopEnabled === true,
                          });
                const audibleStartBeat =
                    iteration.iterationStartBeat + loopAdvanceBeats + groovedNote.startBeat - iteration.midiOffsetBeats;
                const loops = iteration.loopEnabled === true && loopLengthBeats > 0;
                const passStartBeat = iteration.iterationStartBeat;
                const passNoteStartBeat = loops
                    ? loopPassProducedNoteStartBeat(audibleStartBeat, passStartBeat, loopLengthBeats)
                    : Math.max(audibleStartBeat, passStartBeat);
                const passNoteEndBeat = loops
                    ? loopPassNoteEndBeat(passNoteStartBeat, groovedNote.duration, passStartBeat, loopLengthBeats)
                    : audibleStartBeat + groovedNote.duration;
                const overflowBeats = loops
                    ? loopPassNoteOverflowBeats(passNoteStartBeat, groovedNote.duration, passStartBeat, loopLengthBeats)
                    : 0;
                const sourceInstanceId = `${iteration.routeId}:${sourceNote.id}`;
                // A head off the grid opens the first pass before the clip
                // does; the clip head cuts what that pass places ahead of it.
                const clipHeadBeat = loops ? iteration.clipStartBeat : undefined;
                // How far into its note a segment begins: a clamped start cut
                // its head off, a re-anchored start cut nothing, and the
                // pass-head tail begins where the in-pass segment ends.
                const passSegments: LivePassSegment[] = [
                    cutLiveSegmentAtClipHead(
                        {
                            instanceId: sourceInstanceId,
                            startBeat: passNoteStartBeat,
                            endBeat: passNoteEndBeat,
                            velocity: groovedNote.velocity,
                            headCutBeats: loops ? 0 : passNoteStartBeat - audibleStartBeat,
                        },
                        clipHeadBeat
                    ),
                ];
                if (overflowBeats > 0) {
                    passSegments.push(
                        cutLiveSegmentAtClipHead(
                            {
                                instanceId: `${sourceInstanceId}${LOOP_PASS_OVERFLOW_INSTANCE_SUFFIX}`,
                                startBeat: passStartBeat,
                                endBeat: passStartBeat + overflowBeats,
                                velocity: groovedNote.velocity,
                                headCutBeats: passNoteEndBeat - passNoteStartBeat,
                            },
                            clipHeadBeat
                        )
                    );
                }
                const passGeometry = { noteId: sourceNote.id, passStartBeat, loopLengthBeats, clipHeadBeat };
                const rackSegments = passSegments
                    .flatMap((passSegment) =>
                        loops ? placeProjectGrooveDisplacement(passSegment, passGeometry) : [passSegment]
                    )
                    .filter((rackSegment) => rackSegment.endBeat > rackSegment.startBeat);
                const eventContext = {
                    block,
                    changes,
                    transport,
                    sampleRate,
                    routeId: iteration.routeId,
                    channel: sourceNote.channel ?? 0,
                    pitch: groovedNote.pitch,
                    durationPpq: loops ? undefined : Math.max(0, groovedNote.duration),
                };
                for (const rackSegment of rackSegments) {
                    recordLiveSegmentInstance(rackSegment, headCutBeatsByInstance, sequencerGroovedInstances);
                    pushLiveSegmentEvents(inputEvents, rackSegment, eventContext);
                }
            }
        }

        const blockOutput = await processor.processBlock({
            context,
            rackId,
            routeId: trackId,
            trackId,
            events: inputEvents,
            blockStartSamples: beatToSamples(changes, block.fromBeat, transport.tempo, sampleRate),
            blockEndSamples: beatToSamples(changes, block.toBeat, transport.tempo, sampleRate),
            transport: {
                sampleRate,
                bpm: blockTempo,
                ppqPosition: block.fromBeat,
                isPlaying: true,
                barIndex: barBeat.bar - 1,
                beatInBar: barBeat.beat - 1 + barBeat.tick / 480,
                timeSigNum: blockTimeSignature.numerator,
                timeSigDen: blockTimeSignature.denominator,
                loopEnabled: transport.loopStart < transport.loopEnd,
                loopStartPpq: transport.loopStart,
                loopEndPpq: transport.loopEnd,
                discontinuityEpoch,
                tempoMap,
            },
            preserveInputTrackIds: true,
        });
        if (!isCurrent()) {
            return null;
        }
        processedEvents.push(...blockOutput);
    }

    const iterationsByRoute = new Map(iterations.map((iteration) => [iteration.routeId, iteration]));
    const notesByRoute = new Map<string, LiveYeastNote[]>();
    const generatedNotes: LiveYeastNote[] = [];
    const pendingByRouteAndPitch = new Map<string, PendingLiveYeastNote>();
    const pendingByInstance = new Map<string, PendingIdentifiedLiveYeastNote>();
    const orderedEvents = processedEvents.map((event, ordinal) => ({ event, ordinal }));
    orderedEvents.sort(
        (alpha, beta) => alpha.event.timeSamples - beta.event.timeSamples || alpha.ordinal - beta.ordinal
    );

    for (const { event, ordinal } of orderedEvents) {
        if (event.kind.type !== 'noteOn' && event.kind.type !== 'noteOff') {
            continue;
        }

        const iteration = event.trackId
            ? (routeLineage?.get(event.trackId) ?? iterationsByRoute.get(event.trackId))
            : undefined;
        const routeId = iteration?.routeId ?? trackId;
        const noteKey = `${routeId}:${event.kind.channel}:${event.kind.note}`;
        const targetNotes = iteration ? (notesByRoute.get(routeId) ?? []) : generatedNotes;
        if (iteration && !notesByRoute.has(routeId)) {
            notesByRoute.set(routeId, targetNotes);
        }

        if (event.kind.type === 'noteOn') {
            // A pass-head tail plays its note's template: it is that note.
            const sourceInstanceId = event.noteInstanceId && loopPassSourceInstanceId(event.noteInstanceId);
            const identifiedTemplate = iteration?.sourceNotes.find(
                (sourceNote) => `${iteration.routeId}:${sourceNote.id}` === sourceInstanceId
            );
            const template = identifiedTemplate ??
                iteration?.sourceNotes[0] ?? {
                    id: iteration?.clipId ?? trackId,
                    pitch: 60,
                    startBeat: 0,
                    duration: 0,
                    velocity: 100,
                    probability: 100,
                };
            const eventPpq = event.timePpq ?? samplesToBeat(changes, event.timeSamples, transport.tempo, sampleRate);
            let duration = iteration ? template.duration : 0.25;
            if (event.durationSamples !== undefined) {
                const endPpq = samplesToBeat(
                    changes,
                    event.timeSamples + Math.max(0, event.durationSamples),
                    transport.tempo,
                    sampleRate
                );
                duration = Math.max(0, endPpq - eventPpq);
            }
            const noteIndex = targetNotes.length;
            if (event.noteInstanceId) {
                pendingByInstance.set(event.noteInstanceId, {
                    notes: targetNotes,
                    index: noteIndex,
                });
            } else {
                const pending = pendingByRouteAndPitch.get(noteKey) ?? { indices: [], cursor: 0 };
                pending.indices.push(noteIndex);
                pendingByRouteAndPitch.set(noteKey, pending);
            }
            // #4655 — the event time is already the audible beat; the
            // offset was applied once at ownership above and must not be
            // subtracted again here.
            // A note Yeast generates has no recorded curve of its own. It borrows the first source note's scalars
            // above, but never that note's curves, which would replay on a pitch they were not played on.
            const outputNote: LiveYeastNote = {
                ...template,
                expression: identifiedTemplate?.expression,
                id: `${template.id}:yeast:${event.kind.note}:${event.timeSamples}:${ordinal}`,
                sourceEventId: event.sourceEventId,
                noteInstanceId: event.noteInstanceId,
                pitch: event.kind.note,
                velocity: event.kind.velocity,
                startBeat: eventPpq,
                duration,
            };
            const headCutBeats = event.noteInstanceId ? headCutBeatsByInstance.get(event.noteInstanceId) : undefined;
            if (headCutBeats !== undefined) {
                outputNote.beatsIntoNote = headCutBeats;
            }
            if (event.noteInstanceId !== undefined && sequencerGroovedInstances.has(event.noteInstanceId)) {
                outputNote.sequencerGrooveApplied = true;
            }
            targetNotes.push(outputNote);
            continue;
        }

        let noteTarget = targetNotes;
        let noteIndex: number;
        if (event.noteInstanceId) {
            const pending = pendingByInstance.get(event.noteInstanceId);
            if (!pending) {
                continue;
            }
            pendingByInstance.delete(event.noteInstanceId);
            noteTarget = pending.notes;
            noteIndex = pending.index;
        } else {
            const pending = pendingByRouteAndPitch.get(noteKey);
            if (!pending || pending.cursor >= pending.indices.length) {
                continue;
            }
            noteIndex = pending.indices[pending.cursor++]!;
        }
        const note = noteTarget[noteIndex]!;
        const eventPpq = event.timePpq ?? samplesToBeat(changes, event.timeSamples, transport.tempo, sampleRate);
        noteTarget[noteIndex] = {
            ...note,
            duration: Math.max(0, eventPpq - note.startBeat),
        };
    }

    return { notesByRoute, generatedNotes };
}
