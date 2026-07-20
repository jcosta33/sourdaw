import { type OfflineMidiEventProjector } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';

type ProcessedOfflineYeastNote = {
    id: string;
    pitch: number;
    velocity: number;
    startPpq: number;
    endPpq: number;
};

type ProjectOfflineYeastClipNotesInput = {
    notes: readonly ProcessedOfflineYeastNote[];
    clipId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    loopEnabled: boolean;
    toasterPadIndex: number;
    sampleRate: number;
    defaultTempo: number;
    changes: Parameters<OfflinePpqEndpointProjector>[0]['changes'];
    projectMidiEvents: OfflineMidiEventProjector;
    projectPpqEndpoints: OfflinePpqEndpointProjector;
};

export function projectOfflineYeastClipNotes({
    notes,
    clipId,
    clipStartBeat,
    clipEndBeat,
    iterationStartBeat,
    loopLengthBeats,
    midiOffsetBeats,
    loopEnabled,
    toasterPadIndex,
    sampleRate,
    defaultTempo,
    changes,
    projectMidiEvents,
    projectPpqEndpoints,
}: ProjectOfflineYeastClipNotesInput) {
    const projectedNotes = projectMidiEvents({
        events: notes.map((note) => ({
            id: note.id,
            pitch: note.pitch,
            velocity: note.velocity,
            startBeat: note.startPpq - midiOffsetBeats,
            duration: Math.max(0, note.endPpq - note.startPpq),
        })),
        clipId,
        clipStartBeat,
        clipEndBeat,
        iterationStartBeat,
        loopLengthBeats,
        midiOffsetBeats,
        loopEnabled,
        clipGrooveAlreadyApplied: true,
        eventsAreAbsolute: true,
        phase: 'complete',
    });

    return projectedNotes.map((note) => {
        const endpoints = projectPpqEndpoints({
            startPpq: note.startBeat,
            endPpq: note.startBeat + note.duration,
            defaultTempo,
            sampleRate,
            changes,
        });
        return {
            id: note.id,
            pitch: note.pitch,
            velocity: note.velocity,
            startSamples: endpoints.startSamples,
            endSamples: endpoints.endSamples,
            toasterPadIndex,
        };
    });
}
