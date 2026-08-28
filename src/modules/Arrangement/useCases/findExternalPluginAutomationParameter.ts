import { type ExternalPluginParameter, externalPluginParameterStore } from '#/modules/PluginHost/stores';

/**
 * The parameter an external plugin instance published under this automation
 * target id, or undefined when the instance offers no such ride.
 *
 * Read straight off the published snapshot rather than through
 * `getAutomationDeviceDescriptor`: that projection builds a fresh
 * `DeviceParameter` for every parameter the plugin declares, and the scheduler
 * asks this question once per device per lane per tick — a 300-parameter synth
 * on four lanes at 100 Hz would allocate over a hundred thousand short-lived
 * objects a second on the audio scheduling path to answer it. The projection
 * stays where it earns its cost: the menu and the descriptor readers.
 *
 * The attachment gate is the descriptor's, unchanged: an instance in no
 * rendering graph performs no ride, so it declares nothing here either.
 */
export function findExternalPluginAutomationParameter(
    externalInstanceId: string,
    parameterId: string
): ExternalPluginParameter | undefined {
    const snapshot = externalPluginParameterStore.value?.byInstanceId[externalInstanceId];
    if (!snapshot?.engineAttached) {
        return undefined;
    }
    // A snapshot id is the plugin's own `u32`; a target id carries it as the
    // string the lane stores. Compare in the string domain the target owns.
    return snapshot.parameters.find((parameter) => String(parameter.id) === parameterId);
}
