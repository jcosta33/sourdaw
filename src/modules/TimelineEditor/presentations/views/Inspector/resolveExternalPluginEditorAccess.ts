import { type ExternalPluginActivationStatus } from '#/modules/PluginHost/stores';
import { resolvePluginEditorCapability } from '#/modules/PluginHost/useCases';

import { type Device } from '../../../models/TrackViewTypes';

/**
 * Whether an external plugin device's Open editor control can act: `openable` when it is shown,
 * `no-editor` when the scan reports the plugin has no window of its own, and `not-loaded` otherwise.
 */
export type ExternalPluginEditorAccess = 'openable' | 'no-editor' | 'not-loaded';

export type SupportedScannedPlugin = {
    id: string;
    descriptor_id?: string;
    has_custom_ui?: boolean;
    capability_metadata_reason?: string;
};

/**
 * The single answer the device list's Open editor control and the inspector both read, so the control
 * and the text that points at it cannot disagree. `supportedPlugins` is the scan filtered to supported
 * formats; a device whose plugin is absent from it, or whose instance is not `active`, is `not-loaded`.
 */
export function resolveExternalPluginEditorAccess(
    device: Pick<Device, 'externalPluginId' | 'externalInstanceId'>,
    supportedPlugins: readonly SupportedScannedPlugin[],
    activations: Readonly<Record<string, ExternalPluginActivationStatus>>
): ExternalPluginEditorAccess {
    const instanceId = device.externalInstanceId;
    const pluginId = device.externalPluginId;
    if (!instanceId || !pluginId) {
        return 'not-loaded';
    }
    const scanned = supportedPlugins.find((plugin) => plugin.id === pluginId || plugin.descriptor_id === pluginId);
    if (!scanned || activations[instanceId]?.status !== 'active') {
        return 'not-loaded';
    }
    if (resolvePluginEditorCapability(scanned) === 'absent') {
        return 'no-editor';
    }
    return 'openable';
}
