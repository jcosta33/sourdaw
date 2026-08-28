import { executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { compileAddDeviceAction } from './compileAddDeviceAction';

type AddDeviceDispatchResult =
    | { status: 'applied'; deviceId: string | null }
    | { status: 'committed-degraded'; deviceId: string | null }
    | { status: 'not-applied'; deviceId: null };

/**
 * The presentation door for adding one device to a track.
 *
 * A device add commits to project truth even when the audio runtime cannot
 * realize it — on a machine without a working audio graph the project keeps
 * the device while the strip stays unrealized. `executeAppAction` reports that
 * split as a rejected promise (`AppActionCommittedError`), so a caller that
 * fires the action without consuming the rejection turns an expected degraded
 * outcome into an unhandled rejection. This door consumes every outcome: the
 * device id is returned for follow-up UI, degraded and failed outcomes surface
 * as user notifications, and the returned promise never rejects.
 */
export async function executeAddDeviceAction(trackId: string, deviceType: string): Promise<AddDeviceDispatchResult> {
    const action = compileAddDeviceAction(trackId, deviceType);
    if (!action) {
        notifyUser(`"${deviceType}" cannot be added to this track.`, 'error');
        return { status: 'not-applied', deviceId: null };
    }
    const deviceId = action.payload.deviceId ?? null;
    try {
        await executeAppAction(action);
        return { status: 'applied', deviceId };
    } catch (error) {
        if (isAppActionCommittedError(error)) {
            notifyUser(`"${deviceType}" was added to the project but requires runtime retry or repair.`, 'error');
            return { status: 'committed-degraded', deviceId };
        }
        notifyUser(`"${deviceType}" could not be added to the track.`, 'error');
        return { status: 'not-applied', deviceId: null };
    }
}
