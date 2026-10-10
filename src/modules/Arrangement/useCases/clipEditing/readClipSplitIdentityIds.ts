import { getCrdtDoc } from '#/modules/CrdtDocument/useCases';
import { isRecord } from '#/utils/structuralEquality';

import { getTrackState } from '../../repositories/track/getTrackState';
import { collectClipSplitIdentityIds } from '../../services/collectClipSplitIdentityIds';

import type { ClipAutomationLaneSnapshot, ClipSnapshot } from '#/utils/handlerContract';

/** Automation shares the live project's identity namespace. Arrangement snapshots
 * have their own namespace, and canonical gain points are local to their clip.
 * Read Automation from the current/prefix owner state so replay can retire its
 * expected right lanes without treating their own committed IDs as peer reuse. */
export function readClipSplitIdentityIds(
    lanes: readonly ClipAutomationLaneSnapshot[],
    clips: readonly ClipSnapshot[] = getTrackState()?.tracks.flatMap((track) => track.clips) ?? []
): Set<string> {
    const ids = collectClipSplitIdentityIds(lanes);
    const root = getCrdtDoc('root');
    const localPoints = new WeakSet<object>();
    if (root) {
        const gain = root.gainEnvelopes;
        const envelopes = isRecord(gain) && isRecord(gain.envelopes) ? gain.envelopes : {};
        for (const envelope of Object.values(envelopes)) {
            if (!isRecord(envelope) || !Array.isArray(envelope.points)) {
                continue;
            }
            for (const point of envelope.points) {
                if (isRecord(point)) {
                    localPoints.add(point);
                }
            }
        }
        const live = Object.fromEntries(
            Object.entries(root).filter(([key]) => key !== 'arrangements' && key !== 'automation')
        );
        ids.push(...collectClipSplitIdentityIds(live, localPoints));
    }
    // Earlier writes in an open transaction are already visible here while
    // its committed root is still the previous document.
    ids.push(...collectClipSplitIdentityIds(clips));
    return new Set(ids);
}
