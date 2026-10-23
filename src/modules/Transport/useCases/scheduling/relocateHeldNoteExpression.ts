import { relocateNoteExpression } from '#/modules/AudioEngine/useCases';

import { type HeldNote } from './heldNoteExpressionState';
import { holdNoteExpression } from './holdNoteExpression';

type ChannelBend = Parameters<typeof relocateNoteExpression>[0]['channelBend'];

type RelocateHeldNoteExpressionInput = {
    trackId: string;
    /** The notes of this track that sounded when the playback relocated (`detachSoundingNoteExpression`). */
    notes: readonly HeldNote[];
    /** The instrument that plays the track's notes now, undefined when it is bypassed. */
    receiverId: string | undefined;
    /** The frame the relocated window opens on. */
    atFrame: number;
    /** The relocated window's clock, frozen at the time it opened, which later windows keep. */
    frameAtBeat: (beat: number) => number;
    /** The beat that clock places a frame at, to say where a carried note's release now falls. */
    beatAtFrame: (frame: number) => number;
    /** The track's whole channel bend, read when a note is carried. */
    readChannelBend: () => ChannelBend;
};

type RelocatedNoteExpression = {
    pitch: number;
    channel: number;
    expression: NonNullable<ReturnType<typeof relocateNoteExpression>['expression']>;
};

/**
 * Carry the notes still sounding into the pass a relocation opens, and take the bend in force at its
 * destination for each that does not hold it. A note whose release is on or before the opening frame is
 * over, and so is one the track's instrument no longer voices; neither is kept. Those carried are held
 * again with their release placed in the new pass's beats, so the windows that follow move them as any
 * other sounding note.
 */
export function relocateHeldNoteExpression({
    trackId,
    notes,
    receiverId,
    atFrame,
    frameAtBeat,
    beatAtFrame,
    readChannelBend,
}: RelocateHeldNoteExpressionInput): RelocatedNoteExpression[] {
    const due: RelocatedNoteExpression[] = [];
    let channelBend: ChannelBend | undefined;
    for (const note of notes) {
        if (receiverId === undefined || note.receiverId !== receiverId || note.timeline.releaseFrame <= atFrame) {
            continue;
        }
        channelBend ??= readChannelBend();
        const relocated = relocateNoteExpression({ timeline: note.timeline, channelBend, atFrame, frameAtBeat });
        holdNoteExpression({
            ...note,
            trackId,
            releaseBeat: beatAtFrame(note.timeline.releaseFrame),
            timeline: relocated.timeline,
        });
        if (relocated.expression) {
            due.push({ pitch: note.pitch, channel: note.channel, expression: relocated.expression });
        }
    }
    return due;
}
