import { type TailDeclarationLike } from '../../services/estimateRenderTailSeconds';

type DeviceChainEntry = {
    type: string;
    parameterValues: Record<string, number>;
    bypassed: boolean;
};

export type ProjectDeviceTailsInput = {
    devices: ReadonlyArray<DeviceChainEntry>;
    /**
     * Resolves a device type to its declared tail. Injected rather than looked
     * up here: the descriptors live in Arrangement's models, and AudioEngine
     * importing Arrangement's use-case barrel closes a module cycle. The caller,
     * which sits downstream of both, supplies the lookup.
     */
    tailForDeviceType: (deviceType: string) => TailDeclarationLike | undefined;
};

/**
 * Carry each device's declared tail from its descriptor into the estimator's
 * shape.
 *
 * One function rather than a line inlined at each call site, because the number
 * of places that answer "how long does this chain ring?" is exactly the number
 * of answers that can disagree. Freeze used to answer it with a substring test
 * on the device type that no descriptor fed; that is the defect this seam
 * exists to make unrepeatable.
 */
export function projectDeviceTails({ devices, tailForDeviceType }: ProjectDeviceTailsInput) {
    return devices.map((device) => ({
        type: device.type,
        parameterValues: device.parameterValues,
        bypassed: device.bypassed,
        tail: tailForDeviceType(device.type),
    }));
}
