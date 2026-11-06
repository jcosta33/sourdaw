import { type AppAction } from '#/utils/handlerContract';

import { legacyInverseReplayAdmission } from './legacyInverseReplayAdmission';

function isLegacyTrimInverse(action: AppAction): boolean {
    return action.type === 'trimClipStart' && action.payload.midiOffsetBeats === undefined;
}

/**
 * Why a recorded inverse list cannot replay, or `null` when it may. Only a
 * keyless `trimClipStart` inverse needs the owner's admission, so a list
 * without one replays without reading the port.
 */
export function getLegacyInverseReplayFailure(actions: readonly AppAction[], caller: string): string | null {
    if (!actions.some(isLegacyTrimInverse)) {
        return null;
    }
    return legacyInverseReplayAdmission.read(caller).getLegacyTrimInverseReplayFailure(actions);
}
