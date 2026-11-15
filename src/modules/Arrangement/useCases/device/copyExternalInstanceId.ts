import { EXTERNAL_PLUGIN_DEVICE_TYPE } from './externalPluginDeviceType';
import { mintExternalInstanceId } from './mintExternalInstanceId';

/**
 * The instance id for a device copied from a source device or template. A hosted plugin gets its own
 * fresh id, never the source's, so the copy does not share a live host instance; any other device
 * (including a legacy one carrying a stale id) gets none.
 */
export function copyExternalInstanceId(source: { type: string; externalPluginId?: string }): string | undefined {
    if (source.type !== EXTERNAL_PLUGIN_DEVICE_TYPE || !source.externalPluginId) {
        return undefined;
    }
    return mintExternalInstanceId(source.externalPluginId);
}
