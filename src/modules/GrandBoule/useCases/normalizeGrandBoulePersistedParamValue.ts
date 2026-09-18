import { clampDeviceParameterValue, quantiseDeviceParameterValue } from '#/modules/Arrangement/useCases';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

type NormalizeGrandBoulePersistedParamValueInput = {
    defaultValue: number;
    paramId: string;
    value: number | undefined;
};

/** Resolve persisted project data to the exact value Grand Boule's engine and controls use. */
export function normalizeGrandBoulePersistedParamValue({
    defaultValue,
    paramId,
    value,
}: NormalizeGrandBoulePersistedParamValueInput): number {
    const finiteValue = typeof value === 'number' && Number.isFinite(value) ? value : defaultValue;
    const clampedValue = clampDeviceParameterValue({
        deviceType: DEVICE_TYPE_IDS.grandBoule,
        paramId,
        value: finiteValue,
    });
    return quantiseDeviceParameterValue({
        deviceType: DEVICE_TYPE_IDS.grandBoule,
        paramId,
        value: clampedValue,
    });
}
