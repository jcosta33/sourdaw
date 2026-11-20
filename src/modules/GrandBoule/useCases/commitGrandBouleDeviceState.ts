import { logger } from '#/infra/logger/appLogger';
import {
    describeAppActionRefusal,
    executeAppAction,
    isAppActionAdmissionRefusal,
    isAppActionConflictError,
} from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import {
    type GrandBoulePersistedState,
    readGrandBouleDeviceState,
    toGrandBouleDeviceState,
} from '../models/GrandBouleDeviceState';

import { findGrandBouleDevice } from './findGrandBouleDevice';
import { reconcileGrandBouleDeviceStateFromProject } from './reconcileGrandBouleDeviceStateFromProject';

/**
 * Commit a person's Grand Boule edit. A dispatch that does not commit puts the
 * session back on what the document holds, so the control snaps back; the
 * person is told why when the project refused the edit. A handler conflict
 * means the document moved under the edit, so the snap-back shows the newer
 * state and needs no notice. Any other failure is logged.
 */
export function commitGrandBouleDeviceState(deviceId: string, state: GrandBoulePersistedState): void {
    const target = findGrandBouleDevice(deviceId);
    if (!target) {
        return;
    }
    const before = target.device.deviceState ?? null;
    if (valuesEqual(readGrandBouleDeviceState(before), state)) {
        reconcileGrandBouleDeviceStateFromProject(deviceId);
        return;
    }
    const encoded = toGrandBouleDeviceState(state);
    const after = { ...encoded, data: { ...structuredClone(before?.data), ...encoded.data } };
    void executeAppAction({
        type: 'setGrandBouleDeviceState',
        payload: { deviceId, trackId: target.trackId, before: structuredClone(before), after },
    }).catch((error: unknown) => {
        reconcileGrandBouleDeviceStateFromProject(deviceId);
        if (isAppActionAdmissionRefusal(error)) {
            notifyUser(describeAppActionRefusal('setGrandBouleDeviceState'), 'warning');
            return;
        }
        if (!isAppActionConflictError(error)) {
            logger.error(new Error('Grand Boule edit commit failed', { cause: error }));
        }
    });
}
