/**
 * The built-in half of device-parameter automation on the native engine: the
 * law a built-in's lane is held to, and the name its stamp travels under
 * (#3893, #3776).
 *
 * Two producers stamp built-in parameters onto the engine — the live writer
 * (`readLiveAutomationWrites.ts`) and the desktop export
 * (`renderOfflineWithNativeEngine.ts`) — and both must admit, clamp and name a
 * lane identically, or a bounce prints a parameter the monitor never moved, or
 * one the engine refuses by name and takes the whole batch with it. This is
 * the one copy they share.
 *
 * ── Which lanes a built-in admits ───────────────────────────────────────
 *
 * The presence check mirrors `deviceAcceptsAutomationParameter`
 * (`Transport/useCases/scheduling/applyAutomation/applyAutomation.ts`): a key
 * must already sit on the device before either law is asked, because the
 * descriptor law fails open on a name its descriptor never declares — Knead's
 * own descriptor declares no parameters, so the law alone would admit any id a
 * lane can spell. The body's own vocabulary
 * (`nativeBuiltinBody(...).addressesParameter`) is the second gate: it decides
 * whether the engine can resolve the name at all, and one unresolvable name
 * refuses the whole `write-device-parameter` batch. Only once both hold is the
 * declared law itself consulted.
 *
 * `quantiseValue` is the declared *type* law, so without it nothing is
 * admitted: the value stamped would be one nothing had held to the parameter's
 * declared grain. The same holds for a missing automatable predicate or clamp —
 * unset means no law was injected, never "anything goes".
 *
 * ── Which name a stamp travels under ────────────────────────────────────
 *
 * A lane is authored in the id project truth stores, and the engine resolves a
 * built-in stamp by the name that body answers to; for a Fermenter the two are
 * spelled differently on purpose. {@link NativeBuiltinAutomation.addressNatively}
 * re-addresses each such entry through `nativeBuiltinBody` after projection,
 * because the pure projector is handed entries and a law and never reads a
 * type registry.
 */

import { type Device, type Track } from '#/modules/Arrangement/stores';

import { type OfflineDeviceAutomationLaw } from '../../repositories/offlineScheduler/automationScheduling';
import {
    type OfflineDeviceParameterAutomatablePredicate,
    type OfflineDeviceParameterClamp,
    type OfflineDeviceParameterQuantise,
} from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { type StripAutomationWritesEntry } from '../offlineRender/projectStripAutomationWrites';

import { nativeBuiltinBody } from './nativeBuiltinBodies';

/** The declared descriptor law, as the composition-root seam or an export's capture carries it. */
export type BuiltinParameterLawSource = Readonly<{
    isAutomatable: OfflineDeviceParameterAutomatablePredicate | null;
    clampValue: OfflineDeviceParameterClamp | null;
    quantiseValue: OfflineDeviceParameterQuantise | null;
}>;

export type NativeBuiltinAutomation = Readonly<{
    /** The law a built-in lane is held to, or `null` when the source injected none. */
    law: OfflineDeviceAutomationLaw | null;
    /** The entry, its built-in device parameter renamed to what the body answers to. */
    addressNatively: (entry: StripAutomationWritesEntry) => StripAutomationWritesEntry;
}>;

function builtinResolvesParameter(input: {
    device: Device | undefined;
    deviceType: string;
    parameterId: string;
    isAutomatable: OfflineDeviceParameterAutomatablePredicate;
}): boolean {
    const { device, deviceType, parameterId, isAutomatable } = input;
    if (!device) {
        return false;
    }
    if (device.parameterValues[parameterId] === undefined) {
        return false;
    }
    if (!nativeBuiltinBody(deviceType)?.addressesParameter(parameterId)) {
        return false;
    }
    return isAutomatable({ deviceType, paramId: parameterId });
}

export function nativeBuiltinAutomation(input: {
    source: BuiltinParameterLawSource;
    /** Every strip whose devices a lane may name. */
    stripTracks: readonly Track[];
}): NativeBuiltinAutomation {
    const { source, stripTracks } = input;
    const devices = new Map(
        stripTracks.flatMap((track) => track.devices.map((device): [string, Device] => [device.id, device]))
    );

    const addressNatively = (entry: StripAutomationWritesEntry): StripAutomationWritesEntry => {
        if (entry.target.kind !== 'device-parameter') {
            return entry;
        }
        const device = devices.get(entry.target.deviceId);
        const body = device === undefined ? null : nativeBuiltinBody(device.type);
        if (!body) {
            return entry;
        }
        return { ...entry, target: { ...entry.target, parameterId: body.parameterName(entry.target.parameterId) } };
    };

    const { isAutomatable, clampValue, quantiseValue } = source;
    if (!isAutomatable || !clampValue || !quantiseValue) {
        return { law: null, addressNatively };
    }
    return {
        addressNatively,
        law: {
            acceptsAutomation: ({ deviceId, deviceType, parameterId }) =>
                builtinResolvesParameter({ device: devices.get(deviceId), deviceType, parameterId, isAutomatable }),
            clampValue: ({ deviceType, paramId, value }) => clampValue({ deviceType, paramId, value }),
            quantiseValue: ({ deviceType, paramId, value }) => quantiseValue({ deviceType, paramId, value }),
        },
    };
}
