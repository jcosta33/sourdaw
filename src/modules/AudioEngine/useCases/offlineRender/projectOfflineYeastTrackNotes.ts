import { isBeatAdmittedByAnchoredClipLoopWindow } from '#/utils/clipLoopOrigin';

import { type OfflineMidiEventProjector } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { type OfflineYeastMidiProcessor } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';
import { type projectNoteExpressionCurves } from '../noteExpression/projectNoteExpressionCurves';

import { projectOfflineYeastClipNotes } from './projectOfflineYeastClipNotes';
import { projectOfflineYeastNotes } from './projectOfflineYeastNotes';

/** The recorded curves a note carries, in the shape the shared projection reads. */
type OfflineYeastNoteExpression = NonNullable<Parameters<typeof projectNoteExpressionCurves>[0]['note']['expression']>;

type OfflineYeastClipNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
    expression?: OfflineYeastNoteExpression;
};

type OfflineYeastClipIteration = {
    sourceNotes: readonly OfflineYeastClipNote[];
    clipId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    loopEnabled: boolean;
    /** The clip's loop anchor; the membership window reads its advance against it (#5198). */
    loopOriginBeat?: number;
    toasterPadIndex?: number;
    clipGain?: number;
};

type ProjectOfflineYeastTrackNotesInput = {
    trackId: string;
    iterations: readonly OfflineYeastClipIteration[];
    sampleRate: number;
    blockStartSamples: number;
    blockEndSamples: number;
    defaultTempo: number;
    changes: Parameters<OfflinePpqEndpointProjector>[0]['changes'];
    projectMidiEvents: OfflineMidiEventProjector;
    projectPpqEndpoints: OfflinePpqEndpointProjector;
    processYeastMidi: OfflineYeastMidiProcessor;
    projectPitch: (input: { pitch: number; referenceBeat: number; targetBeat: number }) => number;
};

type ScheduledOfflineYeastNote = {
    id: string;
    pitch: number;
    velocity: number;
    startSamples: number;
    endSamples: number;
    toasterPadIndex: number;
    startBeat: number;
    /** How far into the note `startBeat` is when a clip cut took its head off; absent when the note begins there. */
    beatsIntoNote?: number;
    endBeat: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
    expression?: OfflineYeastNoteExpression;
    clipGain: number;
};

function containsBeat(iteration: OfflineYeastClipIteration, beat: number): boolean {
    return (
        iteration.iterationStartBeat <= beat &&
        beat < Math.min(iteration.iterationStartBeat + iteration.loopLengthBeats, iteration.clipEndBeat)
    );
}

export function projectOfflineYeastTrackNotes({
    trackId,
    iterations,
    sampleRate,
    blockStartSamples,
    blockEndSamples,
    defaultTempo,
    changes,
    projectMidiEvents,
    projectPpqEndpoints,
    processYeastMidi,
    projectPitch,
}: ProjectOfflineYeastTrackNotesInput): ScheduledOfflineYeastNote[] {
    const iterationsByRoute = new Map<string, OfflineYeastClipIteration>();
    const sourceNotesByEventId = new Map<string, OfflineYeastClipNote>();
    const sourceNotes = iterations.flatMap((iteration, index) => {
        const routeId = `offline-yeast:${trackId}:${index}`;
        iterationsByRoute.set(routeId, iteration);
        // #5198 — the anchored loop window owns membership on the row's stored
        // figure before the clip-groove phase offers it to the rack: a row
        // past the trimmed region end never enters the pass. An unanchored
        // clip admits without the window, byte-identically to the pre-anchor
        // projector.
        const admittedNotes = iteration.sourceNotes.filter((note) =>
            isBeatAdmittedByAnchoredClipLoopWindow({
                relativeBeat: note.startBeat - iteration.midiOffsetBeats,
                startBeat: iteration.clipStartBeat,
                loopOriginBeat: iteration.loopOriginBeat,
                loopLengthBeats: iteration.loopLengthBeats,
                loopEnabled: iteration.loopEnabled,
            })
        );
        for (const note of admittedNotes) {
            sourceNotesByEventId.set(`${routeId}:${note.id}:on`, note);
        }
        return projectMidiEvents({
            events: admittedNotes,
            clipId: iteration.clipId,
            clipStartBeat: iteration.clipStartBeat,
            clipEndBeat: iteration.clipEndBeat,
            iterationStartBeat: iteration.iterationStartBeat,
            loopLengthBeats: iteration.loopLengthBeats,
            midiOffsetBeats: iteration.midiOffsetBeats,
            loopEnabled: iteration.loopEnabled,
            phase: 'clip-groove',
        }).map((note) => ({
            ...note,
            startBeat: iteration.iterationStartBeat + note.startBeat,
            routeId,
        }));
    });
    const yeastNotes = projectOfflineYeastNotes({
        trackId,
        notes: sourceNotes,
        sampleRate,
        blockStartSamples,
        blockEndSamples,
        projectPpqEndpoints: ({ startPpq, endPpq }) =>
            projectPpqEndpoints({ startPpq, endPpq, defaultTempo, sampleRate, changes }),
        processYeastMidi,
    });
    const scheduledNotes: ScheduledOfflineYeastNote[] = [];

    for (const note of yeastNotes) {
        const iteration = iterationsByRoute.get(note.routeId);
        if (iteration) {
            // The membership gate downstream reads the row's STORED figure,
            // recovered through the rack's instance identity — the routed
            // `startPpq` carries the clip groove and rack re-timing and must
            // never decide membership (#5198 review). A note the rack did not
            // tie back to a source row carries no figure and admits.
            const sourceNote = sourceNotesByEventId.get(note.id);
            const projectedNotes = projectOfflineYeastClipNotes({
                notes: [
                    {
                        ...note,
                        sourceRelativeBeat:
                            sourceNote === undefined ? undefined : sourceNote.startBeat - iteration.midiOffsetBeats,
                    },
                ],
                clipId: iteration.clipId,
                clipStartBeat: iteration.clipStartBeat,
                clipEndBeat: iteration.clipEndBeat,
                iterationStartBeat: iteration.iterationStartBeat,
                loopLengthBeats: iteration.loopLengthBeats,
                midiOffsetBeats: iteration.midiOffsetBeats,
                loopEnabled: iteration.loopEnabled,
                loopOriginBeat: iteration.loopOriginBeat,
                toasterPadIndex: iteration.toasterPadIndex ?? -1,
                sampleRate,
                defaultTempo,
                changes,
                projectMidiEvents,
                projectPpqEndpoints,
                projectPitch,
            });
            for (const projectedNote of projectedNotes) {
                const identifiedNote = sourceNotesByEventId.get(projectedNote.id);
                const sourceNote = identifiedNote ?? iteration.sourceNotes[0];
                // A generated note borrows the first source note's scalars, never its recorded curves, which
                // would replay on a pitch they were not played on.
                scheduledNotes.push({
                    ...projectedNote,
                    pressure: sourceNote?.pressure,
                    slide: sourceNote?.slide,
                    pitchBend: sourceNote?.pitchBend,
                    pitchBendRangeSemitones: sourceNote?.pitchBendRangeSemitones,
                    expression: identifiedNote?.expression,
                    clipGain: iteration.clipGain ?? 1,
                });
            }
            continue;
        }

        if (!iterations.some((iteration) => containsBeat(iteration, note.startPpq))) {
            continue;
        }

        const generatedNotes = projectMidiEvents({
            events: [
                {
                    id: note.id,
                    pitch: note.pitch,
                    velocity: note.velocity,
                    startBeat: note.startPpq,
                    duration: Math.max(0, note.endPpq - note.startPpq),
                },
            ],
            phase: 'sequencer-groove',
        });
        for (const projected of generatedNotes) {
            const carrierIterations = iterations.filter((iteration) => containsBeat(iteration, projected.startBeat));
            const carrierIteration = carrierIterations[0];
            if (!carrierIteration) {
                continue;
            }
            const carrierEndBeat = Math.min(
                carrierIteration.iterationStartBeat + carrierIteration.loopLengthBeats,
                carrierIteration.clipEndBeat
            );
            const noteEndBeat = Math.min(projected.startBeat + projected.duration, carrierEndBeat);
            if (noteEndBeat <= projected.startBeat) {
                continue;
            }
            const carrierPadIndex = carrierIteration.toasterPadIndex;
            const hasUnambiguousPad =
                carrierPadIndex !== undefined &&
                carrierIterations.every((iteration) => iteration.toasterPadIndex === carrierPadIndex);
            const endpoints = projectPpqEndpoints({
                startPpq: projected.startBeat,
                endPpq: noteEndBeat,
                defaultTempo,
                sampleRate,
                changes,
            });
            scheduledNotes.push({
                id: projected.id,
                pitch: projectPitch({
                    pitch: projected.pitch,
                    referenceBeat: carrierIteration.clipStartBeat,
                    targetBeat: projected.startBeat,
                }),
                velocity: projected.velocity,
                startSamples: endpoints.startSamples,
                endSamples: endpoints.endSamples,
                toasterPadIndex: hasUnambiguousPad ? carrierPadIndex : -1,
                startBeat: projected.startBeat,
                endBeat: noteEndBeat,
                clipGain: 1,
            });
        }
    }

    return scheduledNotes;
}
