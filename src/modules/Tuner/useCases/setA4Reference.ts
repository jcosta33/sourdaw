import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { executeAppAction } from '#/modules/Command/useCases';

import { A4_REFERENCE_PARAM_ID } from '../models/A4Reference';

/**
 * Move the tuner's concert-A reference.
 *
 * This used to be a bare `tunerStore` write, which is the whole defect: the
 * number under the knob moved and `TuningSystem::a4_hz` did not, so the analyser
 * went on measuring against 440 and reported the same cents for the same input
 * at every setting of the control.
 *
 * **A drag is one edit, not ninety.** `RotaryKnob` calls `onChange(value, true)`
 * on every pointer-move that crosses a step and once more with `false` on
 * release (`RotaryKnob.tsx:307` and `:189`). Sweeping 440 -> 415 crosses
 * twenty-five 1 Hz steps; committing each one would put twenty-five Automerge
 * transactions and twenty-five undo entries in the history for a single
 * calibration, burying whatever the user actually edited before it.
 * `executeAppAction` coalesces only when handed an `options.groupId`, so
 * dispatching unconditionally really does mean one commit per pointer-move.
 *
 * So the transient half writes the engine and nothing else — the same
 * preview-while-dragging shape as `setTrackPan` and `setYeastProcessorParam`.
 * `updateDeviceParam` is the only route to
 * `ScoringInstance::set_param('a4_hz', …)`, which is what moves the reference
 * the cent readout is measured against, so the tuner re-reads live under the
 * user's thumb; nothing is persisted and no history entry exists yet.
 *
 * The commit half goes through `setDeviceParameter`, the door every other device
 * knob uses. That clamps to the declared range, lands the value on
 * `Device.parameterValues` (replayed into the engine by
 * `projectTrackToLiveStrip` on project open, undo and track restore), and calls
 * `updateDeviceParam` itself. Going through `executeAppAction` rather than
 * calling the use case directly is what puts the move in the CRDT transaction,
 * so the finished gesture — one gesture, one entry — is undoable like any other
 * knob.
 *
 * The transient branch carries its own `resolveEligibleDeviceWriteTarget` gate
 * because it addresses the engine directly: a device id owned by no track, owned
 * twice, or owned by a track kind that does not accept device updates has no
 * write target, and pushing anyway writes to whichever device answers first.
 * The commit branch does not need one — `setDeviceParameter` resolves the same
 * way behind the action.
 */
export function setA4Reference(deviceId: string, hz: number, isTransient = false): void {
    if (isTransient) {
        const target = resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        updateDeviceParam(target.trackId, target.deviceId, A4_REFERENCE_PARAM_ID, hz);
        return;
    }

    void executeAppAction({
        type: 'setDeviceParameter',
        payload: { deviceId, paramId: A4_REFERENCE_PARAM_ID, value: hz },
    });
}
