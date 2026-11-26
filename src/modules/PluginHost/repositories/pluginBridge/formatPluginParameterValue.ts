import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

/**
 * The plugin's own text for `value` of one parameter, or `null` when it offers
 * none. `value` is in the unit `get_plugin_parameters` reports values in.
 */
export async function formatPluginParameterValue(
    instanceId: string,
    paramId: number,
    value: number
): Promise<string | null> {
    if (!isDesktopRuntime()) {
        return null;
    }
    const text: unknown = await desktopInvoke('format_plugin_parameter_value', { instanceId, paramId, value });
    return typeof text === 'string' ? text : null;
}
