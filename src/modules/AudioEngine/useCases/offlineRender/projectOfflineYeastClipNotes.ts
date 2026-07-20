import { type OfflineMidiEventProjector } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { type OfflineYeastMidiProcessor } from '../../repositories/offlineScheduler/offlineYeastMidiProcessorState';

import { projectOfflineYeastNotes } from './projectOfflineYeastNotes';

type OfflineYeastClipNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
};

type ProjectOfflineYeastClipNotesInput = {
    trackId: string;
    sourceNotes: readonly OfflineYeastClipNote[];
    clipId: string;
    clipStartBeat: number;
    clipEndBeat: number;
    iterationStartBeat: number;
    loopLengthBeats: number;
    midiOffsetBeats: number;
    loopEnabled: boolean;
    sampleRate: number;
    blockStartSamples: number;
    blockEndSamples: number;
    defaultTempo: number;
    changes: Parameters<OfflinePpqEndpointProjector>[0]['changes'];
    projectMidiEvents: OfflineMidiEventProjector;
    projectPpqEndpoints: OfflinePpqEndpointProjector;
    processYeastMidi: OfflineYeastMidiProcessor;
};

export function projectOfflineYeastClipNotes({
    trackId,
    sourceNotes,
    clipId,
    clipStartBeat,
    clipEndBeat,
    iterationStartBeat,
    loopLengthBeats,
    midiOffsetBeats,
    loopEnabled,
    sampleRate,
    blockStartSamples,
    blockEndSamples,
    defaultTempo,
    changes,
    projectMidiEvents,
    projectPpqEndpoints,
    processYeastMidi,
}: ProjectOfflineYeastClipNotesInput) {
    const clipGrooveNotes = projectMidiEvents({
        events: sourceNotes,
        clipId,
        clipStartBeat,
        clipEndBeat,
        iterationStartBeat,
        loopLengthBeats,
        midiOffsetBeats,
        loopEnabled,
        phase: 'clip-groove',
    }).map((note) => ({
        ...note,
        startBeat: iterationStartBeat + note.startBeat,
    }));
    const yeastNotes = projectOfflineYeastNotes({
        trackId,
        notes: clipGrooveNotes,
        sampleRate,
        blockStartSamples,
        blockEndSamples,
        projectPpqEndpoints: ({ startPpq, endPpq }) =>
            projectPpqEndpoints({ startPpq, endPpq, defaultTempo, sampleRate, changes }),
        processYeastMidi,
    });
    const yeastNotesWithPpq = yeastNotes.map((note) => ({
        id: note.id,
        pitch: note.pitch,
        velocity: note.velocity,
        startBeat: note.startPpq - midiOffsetBeats,
        duration: Math.max(0, note.endPpq - note.startPpq),
    }));
    const postYeastNotes = projectMidiEvents({
        events: yeastNotesWithPpq,
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

    return postYeastNotes.map((note) => {
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
        };
    });
}
