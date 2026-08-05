import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { A4_REFERENCE_PARAM_ID } from '../models/A4Reference';

/**
 * Move the tuner's concert-A reference.
 *
 * Both writes are required and neither substitutes for the other.
 * `updateDeviceParam` is the single door to the DSP: it reaches
 * `ScoringInstance::set_param('a4_hz', …)` through the worklet port, and that
 * is the only thing that moves `TuningSystem::a4_hz` — which every note name
 * and cent deviation coming back out of the analyser is measured against.
 * `persistDeviceParam` lands the same value on `Device.parameterValues`, which
 * is what a strip rebuild replays (project open, undo, track restore), so
 * without it the engine snaps back to the descriptor's 440 while the panel goes
 * on reporting the reference the user picked.
 *
 * Guarded by `resolveEligibleDeviceWriteTarget` for the same reason every other
 * device bridge is: a device id owned by no track, owned twice, or owned by a
 * track kind that does not accept device updates has no write target, and
 * pushing either half of the pair anyway writes to whichever device answers
 * first.
 *
 * The declared 400..490 Hz range is deliberately not enforced here —
 * `updateDeviceParam` and `persistDeviceParam` each clamp against the
 * descriptor themselves, so the engine and the stored row cannot land on
 * different values.
 */
export function setA4Reference(deviceId: string, hz: number): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    updateDeviceParam(target.trackId, target.deviceId, A4_REFERENCE_PARAM_ID, hz);
    persistDeviceParam(target.deviceId, A4_REFERENCE_PARAM_ID, hz);
}
