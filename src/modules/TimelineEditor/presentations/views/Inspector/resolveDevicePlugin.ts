import { isExternalPluginDeviceType } from '#/modules/Arrangement/useCases';

type NamedPlugin = { id: string; name: string };

/**
 * The builtin descriptor a stored device opens with, or undefined when it has none.
 *
 * A third-party plugin device (`external-plugin`) never resolves: its parameters belong to the
 * plugin, so the inspector shows where the plugin's own editor is instead. Its stored name is the
 * scanned plugin name and can equal a builtin's display name, so the name fallback must never see it.
 *
 * Otherwise the device's type decides first: its exact id, then the `builtin-` id older projects
 * stored without the prefix. Only a device whose type names no descriptor falls back to the type read
 * as a display name (case-insensitive), then to its stored name. A stored name can equal another
 * plugin's name (a project saved before the Faust builds were renamed), so matching it in the same
 * pass as the type would open the wrong plugin's parameters.
 */
export function resolveDevicePlugin<Plugin extends NamedPlugin>(
    plugins: readonly Plugin[],
    device: { type?: string; name: string }
): Plugin | undefined {
    if (isExternalPluginDeviceType(device.type)) {
        return undefined;
    }
    const byId =
        plugins.find((plugin) => plugin.id === device.type) ??
        plugins.find((plugin) => plugin.id === `builtin-${device.type}`);
    if (byId) {
        return byId;
    }
    const typeAsName = device.type?.toLowerCase();
    return (
        plugins.find((plugin) => plugin.name.toLowerCase() === typeAsName) ??
        plugins.find((plugin) => plugin.name === device.name)
    );
}
