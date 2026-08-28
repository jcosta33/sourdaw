import { findExternalPluginAutomationParameter } from './findExternalPluginAutomationParameter';

type ClampExternalPluginAutomationValueInput = {
    externalInstanceId: string;
    parameterId: string;
    value: number;
};

/**
 * Hold a delivery to the range an external plugin instance declared for the
 * parameter, the way `clampDeviceParameterValue` holds a builtin device to its
 * descriptor's.
 *
 * The builtin law cannot answer for this family: no descriptor resolves for an
 * external plugin device, so every call it is given is a no-op. The instance's
 * published `minValue`/`maxValue` are the only declared range there is.
 *
 * An unresolvable parameter passes the value through rather than substituting
 * one. Delivery is already gated on acceptance, which resolves against this
 * same snapshot, so reaching here without a parameter means the snapshot moved
 * mid-tick — and inventing a bound for a parameter nobody declared would be a
 * guess, not a clamp.
 */
export function clampExternalPluginAutomationValue({
    externalInstanceId,
    parameterId,
    value,
}: ClampExternalPluginAutomationValueInput): number {
    const parameter = findExternalPluginAutomationParameter(externalInstanceId, parameterId);
    if (!parameter) {
        return value;
    }
    const { minValue, maxValue } = parameter;
    // A plugin that reports a non-finite or inverted range has declared no
    // usable bound; clamping to it would move the value somewhere the plugin
    // never asked for.
    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || maxValue < minValue) {
        return value;
    }
    return Math.min(Math.max(value, minValue), maxValue);
}
