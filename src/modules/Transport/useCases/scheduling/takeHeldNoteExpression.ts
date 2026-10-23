import { advanceNoteExpression } from '#/modules/AudioEngine/useCases';

import { heldNotesByTrack, type HeldNote } from './heldNoteExpressionState';

type ChannelBendMoves = Parameters<typeof advanceNoteExpression>[0]['channelMoves'];

type TakeHeldNoteExpressionInput = {
    trackId: string;
    /** Where the window opens. */
    fromBeat: number;
    /** Where the window closes: a change at or past it waits for a later window. */
    toBeat: number;
    /** The frame `fromBeat` is placed on, where the expression in force when the window opens is posted. */
    fromFrame: number;
    /**
     * The track's channel bend moves this window takes, read from the clips as they are now. Called at most
     * once, and only when a sounding note follows the channel bend. A window that resumes a track or a clip
     * after a mute lists the moves from the start of the timeline, so a note is given the bend in force.
     */
    readChannelBend: () => ChannelBendMoves;
};

type DueNoteExpression = {
    pitch: number;
    channel: number;
    change: ReturnType<typeof advanceNoteExpression>['changes'][number];
};

/**
 * Take every move of one track's sounding notes that lies before `toBeat`. A move inside the window is
 * due as it stands. A move before `fromBeat` belongs to a window that did not run for this track (it was
 * muted), and is never posted late; but the instrument was not told of it, so a note still sounding at
 * `fromBeat` is given the last such move, the full expression in force there, at `fromFrame`, ahead of
 * the window's own changes. A note released at or before `fromBeat` is over: nothing is posted for it.
 */
export function takeHeldNoteExpression({
    trackId,
    fromBeat,
    toBeat,
    fromFrame,
    readChannelBend,
}: TakeHeldNoteExpressionInput): DueNoteExpression[] {
    const held = heldNotesByTrack.get(trackId);
    if (!held) {
        return [];
    }
    let channelMoves: ChannelBendMoves | undefined;
    const due: DueNoteExpression[] = [];
    const remaining: HeldNote[] = [];
    for (const note of held) {
        if (note.releaseBeat <= fromBeat) {
            continue;
        }
        if (note.followsChannelBend) {
            channelMoves ??= readChannelBend();
        }
        const advanced = advanceNoteExpression({
            timeline: note.timeline,
            fromBeat,
            toBeat,
            fromFrame,
            channelMoves: note.followsChannelBend ? (channelMoves ?? []) : [],
        });
        for (const change of advanced.changes) {
            due.push({ pitch: note.pitch, channel: note.channel, change });
        }
        remaining.push({ ...note, timeline: advanced.timeline });
    }
    heldNotesByTrack.set(trackId, remaining);
    return due;
}
