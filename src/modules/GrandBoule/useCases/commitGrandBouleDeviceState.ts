import { executeAppAction } from '#/modules/Command/useCases';

import { type GrandBoulePersistedState, toGrandBouleDeviceState } from '../models/GrandBouleDeviceState';

import { findGrandBouleDevice } from './findGrandBouleDevice';
import { projectGrandBoulePersistedState } from './projectGrandBoulePersistedState';
import { reconcileGrandBouleDeviceStateFromProject } from './reconcileGrandBouleDeviceStateFromProject';

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
    void executeAppAction({ type: 'setGrandBouleDeviceState', payload: { deviceId, before, after } }).catch(() =>
        reconcileGrandBouleDeviceStateFromProject(deviceId)
    );
}
