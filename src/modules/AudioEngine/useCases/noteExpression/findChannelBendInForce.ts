import { type ChannelBendPoint } from './noteExpressionTimeline';
import { reachesChannel } from './reachesChannel';

/**
 * The moves of one projection that reach each note channel, listed once per projection. A caller asks for every
 * note it starts against the same projected array, and one channel's notes can be reached by a small share of
 * it, so each search runs over that channel's own list rather than walking back past other channels' moves. A
 * projection is never changed once listed, so the list stays its own.
 */
const reachingMovesByProjection = new WeakMap<readonly ChannelBendPoint[], Map<number, readonly ChannelBendPoint[]>>();

function listMovesReaching(channelBend: readonly ChannelBendPoint[], noteChannel: number): readonly ChannelBendPoint[] {
    let byChannel = reachingMovesByProjection.get(channelBend);
    if (!byChannel) {
        byChannel = new Map();
        reachingMovesByProjection.set(channelBend, byChannel);
    }
    let reaching = byChannel.get(noteChannel);
    if (!reaching) {
        reaching = channelBend.filter((move) => reachesChannel(move, noteChannel));
        byChannel.set(noteChannel, reaching);
    }
    return reaching;
}

/** The last move placed at or before `frame` that reaches a note on `noteChannel`: the bend in force there. */
export function findChannelBendInForce(
    channelBend: readonly ChannelBendPoint[],
    frame: number,
    noteChannel: number | undefined
): ChannelBendPoint | undefined {
    const reaching = noteChannel === undefined ? channelBend : listMovesReaching(channelBend, noteChannel);
    let low = 0;
    let high = reaching.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (reaching[middle]!.frame <= frame) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return reaching[low - 1];
}
