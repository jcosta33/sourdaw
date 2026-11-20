/**
 * The one law device-parameter automation is held to on the native engine,
 * across both device families (#3568, #3776, #4592).
 *
 * Two producers stamp device parameters onto the engine — the live writer
 * (`readLiveAutomationWrites.ts`) and the desktop export's native render
 * (`renderOfflineWithNativeEngine.ts`) — and a hosted plugin's lane must be
 * admitted and clamped identically by both, or a bounce prints a ride the
 * monitor never made. This is the copy they share; each hands in its own
 * source of the laws (the composition-root seam live, the export's capture
 * offline) and the built-in half `nativeBuiltinAutomation` built from it.
 *
 * The seam carries one half per family, and each half is read on its own:
 * unset means no law was injected for *that* family, not "anything goes" and
 * not a refusal of the other one, whose functions arrived independently and
 * answer a different question.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type OfflineDeviceAutomationLaw } from '../../repositories/offlineScheduler/automationScheduling';
import {
    type OfflineDeviceParameterQuantise,
    type OfflineExternalPluginParameterClamp,
    type OfflineExternalPluginParameterPredicate,
} from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { REFUSE_DEVICE_AUTOMATION } from '../offlineRender/projectStripAutomationWrites';

/** The hosted half of the law and the declared type law, as the seam or a capture carries them. */
export type HostedParameterLawSource = Readonly<{
    acceptsExternalPluginParameter: OfflineExternalPluginParameterPredicate | null;
    clampExternalPluginValue: OfflineExternalPluginParameterClamp | null;
    quantiseValue: OfflineDeviceParameterQuantise | null;
}>;

/** The instance's own published law, for the devices that have one. */
export type HostedParameterHalf = Readonly<{
    accepts: OfflineExternalPluginParameterPredicate;
    clamp: OfflineExternalPluginParameterClamp;
}>;

/** The hosted plugin instance behind each device on these strips, by device id. */
function instanceIdByDeviceId(stripTracks: readonly Track[]): ReadonlyMap<string, string> {
    const instances = new Map<string, string>();
    for (const track of stripTracks) {
        for (const device of track.devices) {
            if (device.externalInstanceId !== undefined) {
                instances.set(device.id, device.externalInstanceId);
            }
        }
    }
    return instances;
}

/** The hosted half answers only when the source can both admit and clamp a plugin parameter. */
function hostedParameterHalf(
    accepts: HostedParameterLawSource['acceptsExternalPluginParameter'],
    clamp: HostedParameterLawSource['clampExternalPluginValue']
): HostedParameterHalf | null {
    if (!accepts || !clamp) {
        return null;
    }
    return { accepts, clamp };
}

/**
 * The two halves of the seam, and the one law the projection is held to.
 *
 * `quantiseValue` is the declared *type* law and belongs to both halves: it is
 * asked of the device type, which every family has. Without it neither family
 * can be admitted, because the value stamped would be one nothing had held to
 * the parameter's declared grain.
 */
export function nativeDeviceParameterLaw(input: {
    source: HostedParameterLawSource;
    /** Every strip whose devices a lane may name. */
    stripTracks: readonly Track[];
    builtin: OfflineDeviceAutomationLaw | null;
}): {
    law: OfflineDeviceAutomationLaw;
    hosted: HostedParameterHalf | null;
} {
    const { source, stripTracks, builtin } = input;
    const { acceptsExternalPluginParameter, clampExternalPluginValue, quantiseValue } = source;
    const refused = { law: REFUSE_DEVICE_AUTOMATION, hosted: null };
    if (!quantiseValue) {
        return refused;
    }
    const hosted = hostedParameterHalf(acceptsExternalPluginParameter, clampExternalPluginValue);
    if (!hosted && !builtin) {
        return refused;
    }

    const instances = instanceIdByDeviceId(stripTracks);
    return {
        hosted,
        law: {
            // Which family answers is decided by what the device is, exactly as
            // the engine's own mapper decides it: a device that resolves to an
            // instance is the plugin's to speak for, and anything else is a
            // built-in, held to `nativeBuiltinAutomation`'s law.
            acceptsAutomation: (candidate) => {
                const externalInstanceId = instances.get(candidate.deviceId);
                if (externalInstanceId !== undefined) {
                    return hosted !== null && hosted.accepts(externalInstanceId, candidate.parameterId);
                }
                return builtin !== null && builtin.acceptsAutomation(candidate);
            },
            clampValue: (candidate) => {
                const { deviceId, paramId, value } = candidate;
                const externalInstanceId = instances.get(deviceId);
                if (externalInstanceId !== undefined) {
                    return hosted === null ? value : hosted.clamp({ externalInstanceId, parameterId: paramId, value });
                }
                return builtin === null ? value : builtin.clampValue(candidate);
            },
            // Identity for `external-plugin` today, and read from the source
            // rather than assumed so a declared type law arriving for the
            // family reaches the stamped value the same tick it reaches the
            // tick path's.
            quantiseValue: ({ deviceType, paramId, value }) => quantiseValue({ deviceType, paramId, value }),
        },
    };
}
