import { externalPluginParameterStore } from '#/modules/PluginHost/stores';

import { BUILTIN_PLUGINS } from '../models/DeviceParameter';
import { type DeviceParameter } from '../models/DeviceParameterTypes';

/**
 * What automation needs to know about a device: which parameters it addresses,
 * and under which descriptor identity. Narrower than `PluginDescriptor` because
 * an external plugin instance has no static descriptor to answer the rest — its
 * vendor, format and category are scan-time facts, not automation ones.
 */
type AutomationDeviceDescriptor = {
    id: string;
    parameters: readonly DeviceParameter[];
};

function getBuiltinAutomationDescriptor(deviceType: string): AutomationDeviceDescriptor | undefined {
    const exactDescriptor = BUILTIN_PLUGINS.find((candidate) => candidate.id === deviceType);
    if (exactDescriptor) {
        return exactDescriptor;
    }

    const legacyName = deviceType.toLowerCase();
    return BUILTIN_PLUGINS.find((candidate) => candidate.name.toLowerCase() === legacyName);
}

/**
 * The parameters an external plugin instance reports about itself, projected
 * onto the shape the automation UI and range resolution already consume.
 *
 * Returns undefined for an instance with no published snapshot and for one that
 * is loaded but not attached to the native engine: both are states in which a
 * parameter write reaches no DSP, so offering a lane would promise a ride
 * nothing performs.
 */
function getExternalPluginAutomationDescriptor(
    deviceType: string,
    externalInstanceId: string
): AutomationDeviceDescriptor | undefined {
    const snapshot = externalPluginParameterStore.value?.byInstanceId[externalInstanceId];
    if (!snapshot?.engineAttached) {
        return undefined;
    }

    return {
        id: deviceType,
        parameters: snapshot.parameters.map((parameter) => ({
            // The plugin's own `u32` parameter id, as a string because that is
            // what a target id carries. The bridge addresses the parameter by
            // this number, so it must survive the round trip exactly.
            id: String(parameter.id),
            // These parameters belong to the plugin instance, not to a static
            // descriptor, so the instance is what owns them.
            deviceId: externalInstanceId,
            name: parameter.name,
            // The host reports a continuous range and no step law; a plugin
            // resolves its own stepping internally.
            type: 'float' as const,
            value: parameter.value,
            defaultValue: parameter.defaultValue,
            minValue: parameter.minValue,
            maxValue: parameter.maxValue,
            unit: parameter.unit,
            automatable: parameter.isAutomatable,
            hasAutomation: false,
        })),
    };
}

/**
 * The descriptor automation should resolve a device's parameters against.
 *
 * `externalInstanceId` is what distinguishes one hosted plugin from another:
 * every external plugin device carries the same `type`, so the type alone
 * identifies the family and never the instance whose parameters are wanted.
 */
export function getAutomationDeviceDescriptor(
    deviceType: string,
    externalInstanceId?: string
): AutomationDeviceDescriptor | undefined {
    if (externalInstanceId !== undefined) {
        return getExternalPluginAutomationDescriptor(deviceType, externalInstanceId);
    }
    return getBuiltinAutomationDescriptor(deviceType);
}
