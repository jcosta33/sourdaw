import { type OfflineMidiEventProjector } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { type OfflineYeastMidiProcessor } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';

import { projectOfflineYeastClipNotes } from './projectOfflineYeastClipNotes';
import { projectOfflineYeastNotes } from './projectOfflineYeastNotes';

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
    endBeat: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
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
        for (const note of iteration.sourceNotes) {
            sourceNotesByEventId.set(`${routeId}:${note.id}:on`, note);
        }
        return projectMidiEvents({
            events: iteration.sourceNotes,
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
            const projectedNotes = projectOfflineYeastClipNotes({
                notes: [note],
                clipId: iteration.clipId,
                clipStartBeat: iteration.clipStartBeat,
                clipEndBeat: iteration.clipEndBeat,
                iterationStartBeat: iteration.iterationStartBeat,
                loopLengthBeats: iteration.loopLengthBeats,
                midiOffsetBeats: iteration.midiOffsetBeats,
                loopEnabled: iteration.loopEnabled,
                toasterPadIndex: iteration.toasterPadIndex ?? -1,
                sampleRate,
                defaultTempo,
                changes,
                projectMidiEvents,
                projectPpqEndpoints,
                projectPitch,
            });
            for (const projectedNote of projectedNotes) {
                const sourceNote = sourceNotesByEventId.get(projectedNote.id);
                scheduledNotes.push({
                    ...projectedNote,
                    pressure: sourceNote?.pressure,
                    slide: sourceNote?.slide,
                    pitchBend: sourceNote?.pitchBend,
                    pitchBendRangeSemitones: sourceNote?.pitchBendRangeSemitones,
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
