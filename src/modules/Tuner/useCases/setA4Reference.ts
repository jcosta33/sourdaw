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
 * `setDeviceParameter` is the door the rest of the DAW's device knobs already
 * use, and it is the one that does all three things this parameter needs:
 * clamps to the declared range, lands the value on `Device.parameterValues`
 * (what a strip rebuild replays on project open, undo and track restore), and
 * calls `updateDeviceParam` — the only route to
 * `ScoringInstance::set_param('a4_hz', …)`, which is what actually moves the
 * reference the cent readout is measured against. Going through
 * `executeAppAction` rather than calling the use case directly is what puts the
 * move in the CRDT transaction, so a mis-set reference is undoable like any
 * other knob.
 */
export function setA4Reference(deviceId: string, hz: number): void {
    void executeAppAction({
        type: 'setDeviceParameter',
        payload: { deviceId, paramId: A4_REFERENCE_PARAM_ID, value: hz },
    });
}
