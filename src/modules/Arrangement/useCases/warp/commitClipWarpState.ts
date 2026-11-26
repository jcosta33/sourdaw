import { executeUserAppAction } from '#/modules/Command/useCases';
import { canonicalJson } from '#/utils/canonicalDigest';

import { type WarpState } from '../../models/WarpMarker';
import { normalizeWarpState } from '../../stores/clipSatelliteState';
import { getWarpState } from '../../stores/warpStates';

/**
 * The one route a warp edit reaches project truth: a `setClipWarpState` action
 * guarded on the warp state the edit was computed from, so it is one CRDT
 * transaction and one undo step. An edit that leaves the state unchanged
 * dispatches nothing.
 */
export async function commitClipWarpState(clipId: string, next: WarpState): Promise<void> {
    const current = normalizeWarpState(getWarpState(clipId));
    const warpState = normalizeWarpState(next);
    if (canonicalJson(current) === canonicalJson(warpState)) {
        return;
    }
    await executeUserAppAction({
        type: 'setClipWarpState',
        payload: { clipId, warpState, expectedWarpState: current },
    });
}
