import { type ChannelBendPoint } from './noteExpressionTimeline';

/**
 * Whether a move of the track's channel bend moves a note: a channel's wheel moves only that channel's
 * notes, as the live input moves them, a zone-wide move is heard on every channel, and a note that stores
 * no channel (drawn, imported, step-recorded, or saved before notes kept theirs) hears every move.
 */
export function reachesChannel(move: ChannelBendPoint, noteChannel: number | undefined): boolean {
    return noteChannel === undefined || move.zoneWide || move.channel === noteChannel;
}
