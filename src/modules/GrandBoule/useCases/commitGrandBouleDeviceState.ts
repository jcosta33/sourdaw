import { logger } from '#/infra/logger/appLogger';
import {
    describeAppActionRefusal,
    executeAppAction,
    isAppActionAdmissionRefusal,
    isAppActionConflictError,
} from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { type GrandBoulePersistedState, toGrandBouleDeviceState } from '../models/GrandBouleDeviceState';

import { findGrandBouleDevice } from './findGrandBouleDevice';
import { projectGrandBoulePersistedState } from './projectGrandBoulePersistedState';
import { reconcileGrandBouleDeviceStateFromProject } from './reconcileGrandBouleDeviceStateFromProject';

/**
 * Commit a person's Grand Boule edit. A dispatch that does not commit puts the
 * session back on what the document holds, so the control snaps back; the
 * person is told why when the project refused the edit. A handler conflict
 * means the document moved under the edit, so the snap-back shows the newer
 * state and needs no notice. Any other failure is logged.
 */
export function commitGrandBouleDeviceState(deviceId: string, state: GrandBoulePersistedState): void {
    if (!findGrandBouleDevice(deviceId)) {
        return;
    }
    const before = toGrandBouleDeviceState(projectGrandBoulePersistedState(deviceId));
    const after = toGrandBouleDeviceState(state);
    if (JSON.stringify(before) === JSON.stringify(after)) {
        reconcileGrandBouleDeviceStateFromProject(deviceId);
        return;
    }
    void executeAppAction({ type: 'setGrandBouleDeviceState', payload: { deviceId, before, after } }).catch(
        (error: unknown) => {
            reconcileGrandBouleDeviceStateFromProject(deviceId);
            if (isAppActionAdmissionRefusal(error)) {
                notifyUser(describeAppActionRefusal('setGrandBouleDeviceState'), 'warning');
                return;
            }
            if (!isAppActionConflictError(error)) {
                logger.error(new Error('Grand Boule edit commit failed', { cause: error }));
            }
        }
    );
}
