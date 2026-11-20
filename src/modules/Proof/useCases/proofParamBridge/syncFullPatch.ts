import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { ditherModeToInt } from '../../services/ditherModeToInt';
import { getProofState } from '../../stores/proofStore';

import { sendProofParam } from './helpers';
import { CEILING_PARAMETER, proofLimiterCeilingProjection } from './reconcileProofLimiterCeiling';
import { rehydrateRestoredPatch } from './rehydrateRestoredPatch';
import { sendProofChainOrder } from './sendProofChainOrder';
import { syncDynBands } from './syncDynBands';
import { syncEqBands } from './syncEqBands';
import { syncExciter } from './syncExciter';
import { syncImager } from './syncImager';

function syncCeiling(deviceId: string, displayed: number): void {
    // Readiness sync replaces the placeholder's last receipt for this parameter.
    const ceiling = proofLimiterCeilingProjection.get(deviceId)?.ceilingForSync?.(displayed);
    sendProofParam(deviceId, CEILING_PARAMETER, ceiling?.value ?? displayed, ceiling?.runtimeOwner);
}

/** Send full patch to engine (e.g., after preset load). */
export function syncFullPatch(deviceId: string): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    rehydrateRestoredPatch(deviceId);

    const state = getProofState(deviceId);
    const patch = state.patch;

    // A/B compare (dry/wet at the chain head) is runtime state, not a saved
    // patch field, but the engine head must be re-established on a full sync
    // (e.g. preset load) or the chip and the audio fall out of agreement.
    sendProofParam(deviceId, 'ab_bypass', state.abBypass ? 1 : 0);
    sendProofParam(deviceId, 'input_gain', patch.inputGain);
    sendProofParam(deviceId, 'output_gain', patch.outputGain);
    sendProofParam(deviceId, 'eq_bypass', patch.eqBypassed ? 1 : 0);
    sendProofParam(deviceId, 'dyn_bypass', patch.dynBypassed ? 1 : 0);
    sendProofParam(deviceId, 'img_bypass', patch.imgBypassed ? 1 : 0);
    sendProofParam(deviceId, 'exc_bypass', patch.excBypassed ? 1 : 0);
    sendProofParam(deviceId, 'lim_bypass', patch.limBypassed ? 1 : 0);
    syncCeiling(deviceId, patch.limCeiling);
    sendProofParam(deviceId, 'lim_release', patch.limRelease);
    sendProofParam(deviceId, 'lim_lookahead', patch.limLookahead);
    sendProofParam(deviceId, 'dither_mode', ditherModeToInt(patch.ditherMode));
    sendProofParam(deviceId, 'dither_bits', patch.ditherBits);

    syncEqBands(deviceId);
    syncDynBands(deviceId);
    syncImager(deviceId);
    syncExciter(deviceId);

    sendProofChainOrder(deviceId, patch.chainOrder);
}
