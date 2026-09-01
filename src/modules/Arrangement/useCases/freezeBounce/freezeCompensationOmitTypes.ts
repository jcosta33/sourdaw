import { type Device } from '../../models/Track';

const EXTERNAL_PLUGIN_DEVICE_TYPE = 'external-plugin';

/**
 * Device types the freeze pin must omit from `getCompensationDelay`.
 *
 * `withheldDeviceTypes` covers release-withheld stand-ins the offline print
 * reported. Non-bypassed `external-plugin` devices on this track are omitted
 * separately: live `buildDeviceChain` degrades them (`continue`, empty entries)
 * without setting `releaseWithheld`, so they never appear on the tally.
 */
export function freezeCompensationOmitTypes(
    devices: readonly Device[],
    withheldDeviceTypes: readonly string[]
): string[] {
    const omitTypes = [...withheldDeviceTypes];
    for (const device of devices) {
        if (device.bypassed) {
            continue;
        }
        if (device.type !== EXTERNAL_PLUGIN_DEVICE_TYPE) {
            continue;
        }
        if (omitTypes.includes(device.type)) {
            continue;
        }
        omitTypes.push(device.type);
    }
    return omitTypes;
}
