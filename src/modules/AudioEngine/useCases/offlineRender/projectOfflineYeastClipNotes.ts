import { isBeatAdmittedByAnchoredClipLoopWindow } from '#/utils/clipLoopOrigin';

import { type OfflineMidiEventProjector } from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';

type ProcessedOfflineYeastNote = {
    id: string;
    pitch: number;
    velocity: number;
    startPpq: number;
    endPpq: number;
    /**
     * The note's source row figure (`storedStartBeat - midiOffsetBeats`) — the
     * coordinate every loop-window admission gate reads. The routed `startPpq`
     * carries the clip groove and any rack re-timing, so membership must never
     * read it (#5198 review: a groove-displaced boundary note went silent
     * offline while the live twin voiced it). Absent — a rack note whose
     * source identity the rack did not preserve — admits: the pre-rack gates
     * already owned membership on this same figure.
     */
    sourceRelativeBeat?: number;
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
    // window; the anchored membership is applied here instead, on the note's
    // SOURCE row figure — the same stored `startBeat - midiOffsetBeats` the
    // live ownership test and the pre-rack offline filters read. The routed
    // `startPpq` is a displaced figure: the clip-groove phase moved it pre-rack
    // and the rack may have re-timed it, and testing it dropped boundary notes
    // the live twin sounded (#5198 review). A note without the threaded source
    // figure admits — membership was already decided on it upstream.
    const admittedNotes = notes.filter(
        (note) =>
            note.sourceRelativeBeat === undefined ||
            isBeatAdmittedByAnchoredClipLoopWindow({
                relativeBeat: note.sourceRelativeBeat,
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
            beatsIntoNote: note.beatsIntoNote,
            endBeat: note.startBeat + note.duration,
        };
    });
}
