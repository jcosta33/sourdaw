import { getAutomationDeviceDescriptor } from './getAutomationDeviceDescriptor';

/**
 * Whether a curve may drive this parameter on an external plugin instance.
 *
 * The instance's own published parameter list is the whole contract. Nothing
 * else can serve as one: an external device has no static descriptor, and its
 * `parameterValues` stay empty until something writes a parameter by hand — so
 * reading either would refuse or accept for reasons that have nothing to do
 * with what the plugin offers.
 */
export function acceptsExternalPluginAutomationParameter(
    device: { type: string; externalInstanceId: string },
    parameterId: string
): boolean {
    return (
        getAutomationDeviceDescriptor(device.type, device.externalInstanceId)?.parameters.some(
            (parameter) => parameter.id === parameterId && parameter.automatable
        ) ?? false
    );
}
