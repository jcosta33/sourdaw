import { collectTracksClipBufferIds } from './collectTracksClipBufferIds';
import { timeOperationStateCodec } from './timeOperationStateCodec';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The audio buffer ids a time-operation restore plan can bring back, taken from
 * both halves of its captured-and-replacement track state pair. The track
 * states travel in the codec's encoded form, so they are decoded here — an
 * encoded tree hides `audioBufferId` from any plain structural walk. */
export function collectTimeOperationPlanBufferIds(plan: unknown): string[] {
    const ids = new Set<string>();
    if (!isRecord(plan)) {
        return [];
    }
    const local = plan.local;
    if (!isRecord(local)) {
        return [];
    }
    for (const side of ['expected', 'replacement']) {
        const pair = local[side];
        if (!isRecord(pair)) {
            continue;
        }
        const trackState = timeOperationStateCodec.decodeTrackState(pair.trackState);
        if (trackState) {
            for (const id of collectTracksClipBufferIds(trackState.tracks)) {
                ids.add(id);
            }
        }
    }
    return [...ids];
}
