import { quantiseDeviceParameterValue as modelQuantiseDeviceParameterValue } from '../models/DeviceParameterLaw';

type QuantiseDeviceParameterValueInput = {
    deviceType: string;
    paramId: string;
    value: number;
};

export function quantiseDeviceParameterValue({
    deviceType,
    paramId,
    value,
}: QuantiseDeviceParameterValueInput): number {
    return modelQuantiseDeviceParameterValue({ deviceType, paramId, value });
}
