import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { getRestoredProofChainOrder } from '../services/getRestoredProofChainOrder';

export type PrepareOfflineProofInput = {
    /** Id of the Proof device being rendered; keys its entry in the project. */
    deviceId: string;
    /** Worklet port of the offline Proof instance. */
    port: MessagePort;
};

function findProofParameterValues(deviceId: string): Record<string, number> | null {
    const trackState = getTrackStoreState();
    if (!trackState) {
        return null;
    }

    for (const track of trackState.tracks) {
        const device = track.devices.find((candidate) => candidate.id === deviceId && candidate.type === 'proof');
        if (device) {
            return device.parameterValues;
        }
    }

    return null;
}

/**
 * Give an offline Proof instance the module order the project holds.
 *
 * Order is the one part of a Proof patch that `parameterValues` cannot deliver
 * on its own. It is persisted as `chain_order_0..4`, and the offline path
 * replays every persisted number through `setParam`, which posts
 * `{ type: 'param', name: 'chain_order_0' }`. The worklet's `set_param` matches
 * no `chain_order_` prefix, so those five messages do nothing; the chain only
 * moves on `{ type: 'reorder' }`, which live playback sends from `syncFullPatch`
 * and the offline render never sent at all. Every export therefore rendered the
 * constructor default — EQ → Dynamics → Imager → Exciter → Limiter — no matter
 * what the user had arranged. On a mastering chain that is not a detail: an
 * exciter the user moved after the limiter saturates past the ceiling in the
 * session and into it in the file.
 *
 * The order is read from the project rather than from `proofStore` because the
 * store holds the default patch for any device whose panel has not been opened,
 * and an export does not open panels. `parameterValues` is the same source
 * `syncFullPatch` rehydrates from, and a reorder in the panel persists there
 * through `setProofParamWithPatch`, so the two paths read one truth.
 *
 * The `reorder` message is posted straight to the port, as `prepareOfflineLevain`
 * posts `setInstrument`: `ProofNode.reorderModules` — the same message, the live
 * spelling of it — lives in `AudioEngine/engine/`, which this module may not
 * import.
 */
export function prepareOfflineProof({ deviceId, port }: PrepareOfflineProofInput): void {
    const parameterValues = findProofParameterValues(deviceId);
    if (!parameterValues) {
        return;
    }

    const order = getRestoredProofChainOrder(parameterValues);
    if (!order) {
        return;
    }

    port.postMessage({ type: 'reorder', order });
}
