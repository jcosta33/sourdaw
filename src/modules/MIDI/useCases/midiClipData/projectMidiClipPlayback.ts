import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type MidiCC, type MidiNote } from '../../models/MidiNote';
import { getGrooveProjection } from '../grooveTemplates/getGrooveProjection';

import { projectClipControllerEvents } from './projectClipControllerEvents';

type PlaybackProjectionClip = {
    id: string;
    startBeat: number;
    endBeat: number;
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
 * What a MIDI clip plays across its full length, at timeline beats: every loop pass
 * of its notes and controllers, built by the projections the note scheduler and the
 * stored-controller scheduler read, from the same coordinates they are given (the
 * clip's timeline position, not beat 0). A float wrap remainder that playback sees
 * as no length must not reappear here as a sliver, so nothing is rebased before
 * projecting.
 *
 * Notes come from `projectClipMidiEvents` per pass, so a pass clips a note at its
 * end and a note a slip leaves before the content offset wraps into the pass, as
 * playback does. Controllers come from `projectClipControllerEvents`, so each pass
 * opens with the value in force at its head and a pedal release on the clip's closing
 * line plays on the clip end, the window `(-inf, clip end]` owning it as the last window
 * playback schedules the clip in does. No groove applies. Pitch-bend lanes are not
 * projected here.
 */
export function projectMidiClipPlayback({ notes, controlChanges, clip }: ProjectMidiClipPlaybackInput): {
    notes: MidiNote[];
    controlChanges: MidiCC[];
} {
    const midiOffsetBeats = clip.midiOffsetBeats ?? 0;
    const loopEnabled = clip.loopEnabled ?? false;
    const expansion = projectClipLoopExpansion({
        clipDurationBeats: clip.endBeat - clip.startBeat,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled,
    });

    const playedNotes: MidiNote[] = [];
    for (let iteration = 0; iteration < expansion.iterationCount; iteration++) {
        playedNotes.push(
            ...straightProjection.projectClipMidiEvents({
                events: notes,
                clipId: clip.id,
                clipStartBeat: clip.startBeat,
                clipEndBeat: clip.endBeat,
                iterationStartBeat: clip.startBeat + iteration * expansion.loopLengthBeats,
                loopLengthBeats: expansion.loopLengthBeats,
                midiOffsetBeats,
                loopEnabled,
            })
        );
    }

    // A pass head carry is placed at `(head - offset) + offset`, which for a slip
    // can round just below the clip start. A window opening at the start would drop
    // the value in force at the head, so the window is open on the left: every pass
    // projects only rows from its own span, so nothing placed before the head is a
    // row genuinely before the clip. Such a carry sits on the clip's first tick.
    const controllers = projectClipControllerEvents({
        controlChanges,
        clip: {
            startBeat: clip.startBeat,
            endBeat: clip.endBeat,
            midiOffsetBeats,
            loopEnabled,
            loopLength: clip.loopLength,
        },
        fromBeat: Number.NEGATIVE_INFINITY,
        toBeat: clip.endBeat,
    });

    return {
        notes: playedNotes,
        controlChanges: controllers.map(({ id, controller, value, channel, beat }) => ({
            id,
            controller,
            value,
            channel,
            beat: beat < clip.startBeat ? clip.startBeat : beat,
        })),
    };
}
