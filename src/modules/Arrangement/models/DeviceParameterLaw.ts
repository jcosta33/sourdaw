import { getPluginById } from './DeviceParameter';
import { type DeviceParameter } from './DeviceParameterTypes';

/**
 * What a device parameter's declared contract means at the moment of writing.
 *
 * `automatable` and `minValue`/`maxValue` used to be advisory. `automatable`
 * was read in exactly one place — the picker that offers parameters for a new
 * lane — and the runtime gates that decided whether automation could drive a
 * parameter tested only whether the key was present in `parameterValues`, which
 * it is for anything a panel has ever written. So a lane the UI would refuse to
 * create drove the parameter at full range as soon as it arrived by any other
 * route: a preset, a project file, a stored modulation binding, a model
 * emission. `minValue`/`maxValue` were worse: nothing anywhere clamped a write
 * against them, so narrowing a declared range changed the picker and the
 * modulation depth and nothing else.
 *
 * Both laws live here so there is one definition to read and one to change.
 *
 * Absence of a descriptor means "no declared contract", not "forbidden".
 * Faust devices, hosted plugins and anything with dynamically discovered
 * parameters declare nothing, and their values are still legitimate; both
 * functions therefore pass such a write through untouched. Only a parameter
 * that actually declares a bound is held to it.
 */

type DeviceParameterIdentity = {
    /** `Device.type`, which is matched against `PluginDescriptor.id`. */
    deviceType: string;
    paramId: string;
};

type ClampDeviceParameterValueInput = DeviceParameterIdentity & {
    value: number;
};

function findParameterDescriptor({ deviceType, paramId }: DeviceParameterIdentity): DeviceParameter | undefined {
    return getPluginById(deviceType)?.parameters.find((parameter) => parameter.id === paramId);
}

/**
 * The value a write is actually allowed to land, given the declared range.
 *
 * Clamps rather than rejects. A write that overshoots is a caller bug or stale
 * stored data, and refusing it outright would strand the parameter at whatever
 * it happened to hold; pinning it to the nearest legal value keeps the device
 * usable and keeps the engine's own `_ =>` fallbacks out of the decision.
 */
export function clampDeviceParameterValue({ deviceType, paramId, value }: ClampDeviceParameterValueInput): number {
    const descriptor = findParameterDescriptor({ deviceType, paramId });
    if (!descriptor) {
        return value;
    }

    if (value < descriptor.minValue) {
        return descriptor.minValue;
    }

    if (value > descriptor.maxValue) {
        return descriptor.maxValue;
    }

    return value;
}

/**
 * Whether automation, modulation or a base restore may drive this parameter.
 *
 * This is narrower than "may be written". A knob, a preset or a model action
 * may set a parameter the product declares non-automatable — that is exactly
 * what the flag means, and blocking those would break setting it at all. What
 * the flag forbids is a *curve* driving it over time.
 */
export function isDeviceParameterAutomatable({ deviceType, paramId }: DeviceParameterIdentity): boolean {
    const descriptor = findParameterDescriptor({ deviceType, paramId });
    if (!descriptor) {
        return true;
    }

    return descriptor.automatable;
}
