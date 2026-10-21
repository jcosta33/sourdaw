import { isBeatAdmittedByAnchoredClipLoopWindow } from '#/utils/clipLoopOrigin';

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
    /** The clip's loop anchor; the membership window reads its advance against it (#5198). */
    loopOriginBeat?: number;
    toasterPadIndex: number;
    sampleRate: number;
    defaultTempo: number;
    changes: Parameters<OfflinePpqEndpointProjector>[0]['changes'];
    projectMidiEvents: OfflineMidiEventProjector;
    projectPpqEndpoints: OfflinePpqEndpointProjector;
    projectPitch: (input: { pitch: number; referenceBeat: number; targetBeat: number }) => number;
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
    loopOriginBeat,
    toasterPadIndex,
    sampleRate,
    defaultTempo,
    changes,
    projectMidiEvents,
    projectPpqEndpoints,
    projectPitch,
}: ProjectOfflineYeastClipNotesInput) {
    // #5198 — this post-rack projection runs with `eventsAreAbsolute: true`,
    // so the clip projection inside `projectMidiEvents` never applies the loop
    // window; the anchored membership is applied here instead, on the routed
    // note's region-relative figure (`startPpq - iterationStart -
    // midiOffsetBeats`, the content-relative beat the synth path's admission
    // reads). A row the window drops can no longer reach the rack, and a
    // generator note re-anchored past the region end does not voice either.
    // Unanchored clips admit without the window, byte-identically to the
    // pre-anchor projector.
    const admittedNotes = notes.filter((note) =>
        isBeatAdmittedByAnchoredClipLoopWindow({
            relativeBeat: note.startPpq - iterationStartBeat - midiOffsetBeats,
            startBeat: clipStartBeat,
            loopOriginBeat,
            loopLengthBeats,
            loopEnabled,
        })
    );
    const projectedNotes = projectMidiEvents({
        events: admittedNotes.map((note) => ({
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
            pitch: projectPitch({ pitch: note.pitch, referenceBeat: clipStartBeat, targetBeat: note.startBeat }),
            velocity: note.velocity,
            startSamples: endpoints.startSamples,
            endSamples: endpoints.endSamples,
            toasterPadIndex,
            startBeat: note.startBeat,
            endBeat: note.startBeat + note.duration,
        };
    });
}
