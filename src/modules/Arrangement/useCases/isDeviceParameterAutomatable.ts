import { isDeviceParameterAutomatable as modelIsDeviceParameterAutomatable } from '../models/DeviceParameterLaw';

type IsDeviceParameterAutomatableInput = {
    deviceType: string;
    paramId: string;
};

export function isDeviceParameterAutomatable({ deviceType, paramId }: IsDeviceParameterAutomatableInput): boolean {
    return modelIsDeviceParameterAutomatable({ deviceType, paramId });
}
