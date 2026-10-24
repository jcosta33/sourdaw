import { type ChannelBendPoint } from './noteExpressionTimeline';
import { reachesChannel } from './reachesChannel';

type MovesByChannel = Map<number, readonly ChannelBendPoint[]>;

/**
 * The moves that reach one channel, listed once per projection. A caller asks for every note it starts
 * against the same projected array, and a channel's wheel can be a small share of it, so the search
 * runs over the channel's own moves in O(log n) rather than walking back past the other channels'.
 */
const movesByChannelOfProjection = new WeakMap<readonly ChannelBendPoint[], MovesByChannel>();

function listMovesReaching(channelBend: readonly ChannelBendPoint[], noteChannel: number): readonly ChannelBendPoint[] {
    const cached = movesByChannelOfProjection.get(channelBend) ?? new Map<number, readonly ChannelBendPoint[]>();
    movesByChannelOfProjection.set(channelBend, cached);
    const listed = cached.get(noteChannel) ?? channelBend.filter((move) => reachesChannel(move, noteChannel));
    cached.set(noteChannel, listed);
    return listed;
}

/** The last move placed at or before `frame` that reaches a note on `noteChannel`, the bend in force there. */
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
