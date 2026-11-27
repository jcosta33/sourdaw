import { captureDevicePatchCommitValidation, clampDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { type ToasterMasterGainAction } from '../events/toasterAppActions';
import { fromToasterKitState } from '../models/ToasterKitState';

import { getToasterMasterGainTarget } from './getToasterMasterGainTarget';

function clampMasterGain(value: number): number {
    return clampDeviceParameterValue({ deviceType: DEVICE_TYPE_IDS.toaster, paramId: 'masterGain', value });
}

export function captureToasterMasterGainEdit(deviceId: string) {
    const target = getToasterMasterGainTarget(deviceId);
    if (!target) {
        return null;
    }
    const { trackId, deviceIds, current } = target;
    const before = current.capture;
    const value = before.kind === 'value' ? before.value : fromToasterKitState(current.chunk).masterGain;
    if (clampMasterGain(value) !== value) {
        return null;
    }
    const authority = captureDevicePatchCommitValidation({
        trackId,
        deviceId,
        parameterIds: [],
        requireCurrentProjection: true,
    });
    if (!authority) {
        return null;
    }
    return {
        value,
        isCurrent: authority.isCurrent,
        createAction(rawValue: number): ToasterMasterGainAction | null {
            if (!Number.isFinite(rawValue) || !authority.isCurrent()) {
                return null;
            }
            const gain = clampMasterGain(rawValue);
            if (gain === value) {
                return null;
            }
            return {
                type: 'setToasterMasterGain',
                payload: {
                    deviceId,
                    trackId,
                    deviceIds,
                    before,
                    after: { kind: 'value', value: gain === 0 ? 0 : gain },
                },
            };
        },
    };
}
