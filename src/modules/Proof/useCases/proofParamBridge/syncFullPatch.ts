import { ditherModeToInt } from '../../services/ditherModeToInt';
import { getProofState } from '../../stores/proofStore';

import { bridges } from './helpers';
import { syncDynBands } from './syncDynBands';
import { syncEqBands } from './syncEqBands';
import { syncExciter } from './syncExciter';
import { syncImager } from './syncImager';

/** Send full patch to engine (e.g., after preset load). */
export function syncFullPatch(deviceId: string): void {
    const state = getProofState(deviceId);
    const patch = state.patch;
    const bridge = bridges.get(deviceId);
    if (!bridge) {
        return;
    }

    // A/B compare (dry/wet at the chain head) is runtime state, not a saved
    // patch field, but the engine head must be re-established on a full sync
    // (e.g. preset load) or the chip and the audio fall out of agreement.
    bridge.setParam('ab_bypass', state.abBypass ? 1 : 0);
    bridge.setParam('input_gain', patch.inputGain);
    bridge.setParam('output_gain', patch.outputGain);
    bridge.setParam('eq_bypass', patch.eqBypassed ? 1 : 0);
    bridge.setParam('dyn_bypass', patch.dynBypassed ? 1 : 0);
    bridge.setParam('img_bypass', patch.imgBypassed ? 1 : 0);
    bridge.setParam('exc_bypass', patch.excBypassed ? 1 : 0);
    bridge.setParam('lim_bypass', patch.limBypassed ? 1 : 0);
    bridge.setParam('lim_ceiling', patch.limCeiling);
    bridge.setParam('lim_release', patch.limRelease);
    bridge.setParam('lim_lookahead', patch.limLookahead);
    bridge.setParam('dither_mode', ditherModeToInt(patch.ditherMode));
    bridge.setParam('dither_bits', patch.ditherBits);

    syncEqBands(deviceId);
    syncDynBands(deviceId);
    syncImager(deviceId);
    syncExciter(deviceId);

    bridge.reorderModules(patch.chainOrder);
}
