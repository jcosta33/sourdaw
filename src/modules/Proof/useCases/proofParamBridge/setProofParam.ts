import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { bridges } from './helpers';

type SetProofParamInput = {
    deviceId: string;
    name: string;
    value: number;
};

/**
 * Engine controls that carry no project meaning and must never reach the saved
 * device row.
 *
 * `ab_bypass` is the A/B compare switch: runtime state by contract (see
 * `proofStore.setProofAbBypass`), never read back on restore, and dry at the
 * chain head. Storing it means a project can be reopened, or a raw device row
 * replayed into the engine, with the whole Proof chain silently bypassed while
 * the panel's chip reads "B / wet".
 */
const RUNTIME_ONLY_PARAMS: ReadonlySet<string> = new Set(['ab_bypass']);

export function setProofParam({ deviceId, name, value }: SetProofParamInput): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    bridges.get(deviceId)?.setParam(name, value);
    if (RUNTIME_ONLY_PARAMS.has(name)) {
        return;
    }

    persistDeviceParam(deviceId, name, value);
}
