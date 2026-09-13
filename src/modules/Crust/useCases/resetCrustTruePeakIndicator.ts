import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { updateCrustMeters } from '../stores/crustStore';

/**
 * Clear the panel's held true-peak reading and the engine's.
 *
 * Both halves are needed. The engine holds the session maximum so the readout
 * survives between meter polls, so clearing only the store would put the
 * indicator straight back on the next tick and the button would look inert.
 * The engine reset travels as a parameter over the same bridge every other
 * Crust control uses, rather than as a bespoke message.
 *
 * The store half is scoped to this device's meter slice: a second running
 * Crust keeps its own held reading (#3672).
 */
export function resetCrustTruePeakIndicator(deviceId: string): void {
    updateCrustMeters(deviceId, { truepeakMax: -100, truepeakExceeded: false });

    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    updateDeviceParam(target.trackId, target.deviceId, 'resetTruePeak', 1);
}
