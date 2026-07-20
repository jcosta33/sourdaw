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
};

type ScheduledOfflineYeastNote = {
    id: string;
    pitch: number;
    velocity: number;
    startSamples: number;
    endSamples: number;
    toasterPadIndex: number;
};

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
}: ProjectOfflineYeastTrackNotesInput): ScheduledOfflineYeastNote[] {
    const iterationsByRoute = new Map<string, OfflineYeastClipIteration>();
    const sourceNotes = iterations.flatMap((iteration, index) => {
        const routeId = `offline-yeast:${trackId}:${index}`;
        iterationsByRoute.set(routeId, iteration);
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
            scheduledNotes.push(
                ...projectOfflineYeastClipNotes({
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
                })
            );
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
            const endpoints = projectPpqEndpoints({
                startPpq: projected.startBeat,
                endPpq: projected.startBeat + projected.duration,
                defaultTempo,
                sampleRate,
                changes,
            });
            scheduledNotes.push({
                id: projected.id,
                pitch: projected.pitch,
                velocity: projected.velocity,
                startSamples: endpoints.startSamples,
                endSamples: endpoints.endSamples,
                toasterPadIndex: -1,
            });
        }
    }

    return scheduledNotes;
}
