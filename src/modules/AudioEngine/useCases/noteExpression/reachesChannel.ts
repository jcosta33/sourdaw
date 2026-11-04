import { type ChannelBendPoint } from './noteExpressionTimeline';

/**
 * Whether a move of the track's channel bend moves a note. A row the recorder captured from a channel's wheel
 * with MPE off moves only the notes of that channel, as the live input moves them. Every other row (drawn in the
 * lane, imported, saved before rows were scoped, or an MPE zone master's) moves every note, as every row did
 * before rows were scoped, and so does any row for a note that stores no channel. Only the mark scopes a row:
 * a `.mid` import stores a channel on every note, so an unscoped row never filters by it.
 */
export function reachesChannel(move: ChannelBendPoint, noteChannel: number | undefined): boolean {
    return !move.channelScoped || noteChannel === undefined || move.channel === noteChannel;
}
