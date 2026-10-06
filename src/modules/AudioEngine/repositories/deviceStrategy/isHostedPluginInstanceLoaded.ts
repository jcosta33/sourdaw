type HostedPluginRuntime = {
    /** Instance ids with a loaded parameter snapshot (`readLoadedExternalInstanceIds`). */
    loadedInstanceIds: ReadonlySet<string>;
    /** Whether this process is the desktop runtime (`isDesktopExternalPluginRuntime`). */
    onDesktopRuntime: boolean;
};

/**
 * Whether a hosted plugin device names an instance that sounds live: one
 * loaded on the desktop runtime. A browser build's snapshot never sounds, and
 * a device naming no loaded instance is carried as a unity pass-through.
 */
export function isHostedPluginInstanceLoaded(
    device: { externalInstanceId?: string },
    { loadedInstanceIds, onDesktopRuntime }: HostedPluginRuntime
): boolean {
    return (
        onDesktopRuntime && device.externalInstanceId !== undefined && loadedInstanceIds.has(device.externalInstanceId)
    );
}
