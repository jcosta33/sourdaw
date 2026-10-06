import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type MidiCC, type MidiNote } from '../../models/MidiNote';
import { getGrooveProjection } from '../grooveTemplates/getGrooveProjection';

import { projectClipControllerEvents } from './projectClipControllerEvents';

type PlaybackProjectionClip = {
    id: string;
    /** The clip's length on the timeline, `endBeat - startBeat`. */
    durationBeats: number;
    midiOffsetBeats?: number;
    loopEnabled?: boolean;
    loopLength?: number;
};

type ProjectMidiClipPlaybackInput = {
    notes: readonly MidiNote[];
    controlChanges: readonly MidiCC[];
    clip: PlaybackProjectionClip;
};

// No assignment, so neither the clip's nor the sequencer's groove moves a note:
// an export writes the timing the clip stores, not the swing it is auditioned with.
const straightProjection = getGrooveProjection({ templates: [], assignments: [] });

/**
 * What a MIDI clip plays across its full length, at beats counted from the clip
 * start: every loop pass of its notes and controllers, built by the projections the
 * note scheduler and the stored-controller scheduler read.
 *
 * Notes come from `projectClipMidiEvents` per pass, so a pass clips a note at its
 * end and a note a slip leaves before the content offset wraps into the pass, as
 * playback does. Controllers come from `projectClipControllerEvents`, so each pass
 * opens with the value in force at its head. No groove applies. Pitch-bend lanes
 * are not projected here.
 */
export function projectMidiClipPlayback({ notes, controlChanges, clip }: ProjectMidiClipPlaybackInput): {
    notes: MidiNote[];
    controlChanges: MidiCC[];
} {
    const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
    const loopEnabled = clip.loopEnabled ?? false;
    const expansion = projectClipLoopExpansion({
        clipDurationBeats: clip.durationBeats,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled,
    });

    const playedNotes: MidiNote[] = [];
    for (let iteration = 0; iteration < expansion.iterationCount; iteration++) {
        playedNotes.push(
            ...straightProjection.projectClipMidiEvents({
                events: notes,
                clipId: clip.id,
                clipStartBeat: 0,
                clipEndBeat: clip.durationBeats,
                iterationStartBeat: iteration * expansion.loopLengthBeats,
                loopLengthBeats: expansion.loopLengthBeats,
                midiOffsetBeats,
                loopEnabled,
            })
        );
    }

    return {
        notes: playedNotes,
        controlChanges: projectClipControllerEvents({
            controlChanges,
            clip: {
                startBeat: 0,
                endBeat: clip.durationBeats,
                midiOffsetBeats,
                loopEnabled,
                loopLength: clip.loopLength,
            },
            fromBeat: 0,
            toBeat: clip.durationBeats,
        }),
    };
}
