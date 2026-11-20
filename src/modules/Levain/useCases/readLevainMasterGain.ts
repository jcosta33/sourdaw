import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';

/** Old files can hold the engine key alone. A canonical value takes precedence. */
export function readLevainMasterGain(values: Readonly<Record<string, number>>, fallback: number): number {
    const value = [values.masterGain, values.master_gain].find(Number.isFinite);
    if (value === undefined) {
        return fallback;
    }
    return clampDeviceParameterValue({ deviceType: 'levain', paramId: 'masterGain', value });
}
