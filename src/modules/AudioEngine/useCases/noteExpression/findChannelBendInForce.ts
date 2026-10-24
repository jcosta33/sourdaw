import { type ChannelBendPoint } from './noteExpressionTimeline';
import { reachesChannel } from './reachesChannel';

/** The last move placed at or before `frame` that reaches a note on `noteChannel`, the bend in force there. */
export function findChannelBendInForce(
    channelBend: readonly ChannelBendPoint[],
    frame: number,
    noteChannel: number | undefined
): ChannelBendPoint | undefined {
    let low = 0;
    let high = channelBend.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (channelBend[middle]!.frame <= frame) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    for (let index = low - 1; index >= 0; index--) {
        const move = channelBend[index]!;
        if (reachesChannel(move, noteChannel)) {
            return move;
        }
    }
    return undefined;
}
