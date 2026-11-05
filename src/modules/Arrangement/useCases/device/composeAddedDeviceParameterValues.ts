import { type PluginDescriptor } from '../../models/DeviceParameter';

/**
 * The parameter values a placed device starts with: the internal values (the saved ones when given,
 * else the plugin's own), then every declared parameter at the value the plugin declares for it.
 */
export function composeAddedDeviceParameterValues(
    plugin: PluginDescriptor | undefined,
    initialInternalParameterValues?: Readonly<Record<string, number>>
): Record<string, number> {
    const internalValues = initialInternalParameterValues ?? plugin?.internalParameterValues ?? {};
    const declaredValues = Object.fromEntries(
        (plugin?.parameters ?? []).map((parameter) => [parameter.id, parameter.value])
    );
    return { ...internalValues, ...declaredValues };
}
