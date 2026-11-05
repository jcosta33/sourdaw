import { type PluginDescriptor } from '../../models/DeviceParameter';

/**
 * The parameter values a placed device starts with: the internal values (the saved ones when given,
 * else the plugin's own), then every declared parameter at the value the plugin declares for it.
 */
export function composeAddedDeviceParameterValues(
    plugin: PluginDescriptor | undefined,
    initialInternalParameterValues?: Readonly<Record<string, number>>
): Record<string, number> {
    const parameterValues: Record<string, number> = {
        ...(initialInternalParameterValues ?? plugin?.internalParameterValues ?? {}),
    };
    for (const parameter of plugin?.parameters ?? []) {
        parameterValues[parameter.id] = parameter.value;
    }
    return parameterValues;
}
