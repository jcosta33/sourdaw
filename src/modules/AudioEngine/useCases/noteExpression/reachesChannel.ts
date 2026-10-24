import { type ChannelBendPoint } from './noteExpressionTimeline';

/**
 * Whether a move of the track's channel bend moves a note. A row the recorder captured from a channel's
 * wheel moves only that channel's notes, as the live input moves them. Every other row (drawn in the lane,
 * imported, saved before rows were scoped, or an MPE zone master's) moves every note, as every row did
 * before, and so does any row for a note that stores no channel (drawn, or saved before notes kept theirs).
 * A `.mid` import does store a channel per note, which is why an unscoped row never filters by it.
 */
export function reachesChannel(move: ChannelBendPoint, noteChannel: number | undefined): boolean {
    return !move.channelScoped || noteChannel === undefined || move.channel === noteChannel;
}
