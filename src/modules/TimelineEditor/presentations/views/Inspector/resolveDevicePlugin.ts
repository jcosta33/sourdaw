type NamedPlugin = { id: string; name: string };

/**
 * The descriptor a stored device opens with. The device's type decides first (its exact id, then the
 * `builtin-` id older projects stored without the prefix); only a device whose type names no
 * descriptor falls back to a display name. A stored name can equal another plugin's name (a project
 * saved before the Faust builds were renamed), so matching it in the same pass as the type would
 * open the wrong plugin's parameters.
 */
export function resolveDevicePlugin<Plugin extends NamedPlugin>(
    plugins: readonly Plugin[],
    device: { type?: string; name: string }
): Plugin | undefined {
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
