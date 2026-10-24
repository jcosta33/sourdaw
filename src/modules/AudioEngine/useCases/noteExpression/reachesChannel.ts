import { type ChannelBendPoint } from './noteExpressionTimeline';

/**
 * Whether a move of the track's channel bend moves a note on `noteChannel`: a channel's wheel moves only
 * that channel's notes, as the live input moves them, and a zone-wide move is heard on every channel.
 */
export function reachesChannel(move: ChannelBendPoint, noteChannel: number): boolean {
    return move.zoneWide || move.channel === noteChannel;
}
