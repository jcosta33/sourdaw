import { isDeviceReleaseAdmitted } from '#/infra/release/deviceReleaseAdmission';

import { NATIVE_DSP_DEVICE_FACTORIES, type NativeDspDeviceFactory } from './nativeDspDeviceFactories';

export function findReleasedNativeDspDeviceFactory(deviceType: string): NativeDspDeviceFactory | undefined {
    if (!isDeviceReleaseAdmitted(deviceType)) {
        return undefined;
    }
    return NATIVE_DSP_DEVICE_FACTORIES.find((factory) => factory.matches(deviceType));
}
