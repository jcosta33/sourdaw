import { type ChannelBendPoint } from './noteExpressionTimeline';

/** The last move placed at or before `frame`, the bend in force there. */
export function findChannelBendInForce(
    channelBend: readonly ChannelBendPoint[],
    frame: number
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
    return channelBend[low - 1];
}
