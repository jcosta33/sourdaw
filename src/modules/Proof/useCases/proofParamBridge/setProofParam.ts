import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { DEFAULT_PATCH } from '../../models/ProofPatch';
import { getProofPatchParameterValues } from '../../services/getProofPatchParameterValues';

import { sendProofParam } from './helpers';

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

const productScalars = new Set(
    Object.keys(getProofPatchParameterValues(DEFAULT_PATCH)).filter(
        (name) => name !== 'target_mode' && name !== 'target_lufs' && !name.startsWith('chain_order_')
    )
);

function validScalar(name: string, value: number): boolean {
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
        return false;
    }
    if (name === 'ab_bypass') {
        return value === 0 || value === 1;
    }
    if (!productScalars.has(name)) {
        return false;
    }
    if (/(?:_bypass|_enabled|_auto_makeup)$/.test(name) || name === 'img_auto_mono_bass') {
        return value === 0 || value === 1;
    }
    if (name.endsWith('_type')) {
        const maximum = name.startsWith('eq_') ? 4 : 3;
        return Number.isInteger(value) && value >= 0 && value <= maximum;
    }
    if (name.endsWith('_channel') || name === 'dither_mode') {
        return Number.isInteger(value) && value >= 0 && value <= 2;
    }
    if (name === 'dither_bits') {
        return value === 16 || value === 24;
    }
    return true;
}

export function setProofParam({ deviceId, name, value }: SetProofParamInput): void {
    if (!validScalar(name, value)) {
        return;
    }
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    sendProofParam(deviceId, name, value);
    if (RUNTIME_ONLY_PARAMS.has(name)) {
        return;
    }

    persistDeviceParam(deviceId, name, value);
}
