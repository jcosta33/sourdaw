import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';

/** Old files can hold the engine key alone. A canonical value takes precedence. */
export function readLevainMasterGain(values: Readonly<Record<string, number>>, fallback: number): number {
    const value = [values.masterGain, values.master_gain].find(Number.isFinite);
    return value === undefined
        ? fallback
        : clampDeviceParameterValue({ deviceType: 'levain', paramId: 'masterGain', value });
}
