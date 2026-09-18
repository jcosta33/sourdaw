import { type Device } from '../../models/Track';

const EXTERNAL_PLUGIN_DEVICE_TYPE = 'external-plugin';

/**
 * Device types the freeze pin must omit from `getCompensationDelay`.
 *
 * `withheldDeviceTypes` covers release-withheld stand-ins the offline print
 * reported. Non-bypassed `external-plugin` devices on this track are omitted
 * separately, and the reason is which of the two plugin populations can still
 * reach a completed print: a plugin whose instance the engine holds refuses
 * inside `buildDeviceChain`, so the render never finishes and no tally is
 * taken. One with no attached instance — a duplicated track, a track template,
 * a project opened in the browser build — is silent live and still degrades
 * (`continue`, empty entries) without setting `releaseWithheld`, so it never
 * appears on the tally. That unattached device is what this omit list is for.
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
