import { findSupportedPlugin } from './findSupportedPlugin';

export function getExternalPluginContractVersionForCommand(deviceType: string): string | undefined {
    const plugin = findSupportedPlugin(deviceType);
    if (!plugin) {
        return undefined;
    }
    return JSON.stringify([
        'external-plugin-v1',
        plugin.format,
        plugin.descriptor_id || plugin.id,
        plugin.version,
        plugin.num_inputs,
        plugin.num_outputs,
        plugin.num_parameters,
    ]);
}
