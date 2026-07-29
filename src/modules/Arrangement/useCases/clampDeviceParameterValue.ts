import { clampDeviceParameterValue as modelClampDeviceParameterValue } from '../models/DeviceParameterLaw';

type ClampDeviceParameterValueInput = {
    deviceType: string;
    paramId: string;
    value: number;
};

export function clampDeviceParameterValue({ deviceType, paramId, value }: ClampDeviceParameterValueInput): number {
    return modelClampDeviceParameterValue({ deviceType, paramId, value });
}
