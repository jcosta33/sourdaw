import { setPluginParameter } from '../../repositories/pluginBridge/setPluginParameter';
import { externalPluginParameterStore } from '../../stores/externalPluginParameterStore';

import { publishExternalPluginParameterEdit } from './publishExternalPluginParameterEdit';

type EditExternalPluginParameterInput = {
    instanceId: string;
    parameterId: number;
    value: number;
};

/** Newest send per parameter; a settled send that is no longer the newest is stale. */
const latestSend = new Map<string, number>();
let nextSend = 0;

/**
 * Set a hosted plugin's parameter from the host's own control surface.
 *
 * The value is clamped to the parameter's declared range and sent to the plugin.
 * Only after the plugin accepts it does the snapshot move and the edit reach
 * observers, through the route a vendor-editor edit takes, so the project marks
 * itself dirty the same way. The native host does not echo a host-originated
 * set, which is why this publishes the edit itself.
 *
 * Rejects without patching when the instance or parameter is unknown, the value
 * is not finite, or the host refuses. A send that settles after a newer send for
 * the same parameter is dropped, so a fast drag cannot land an older value last.
 */
export async function editExternalPluginParameter(input: EditExternalPluginParameterInput): Promise<void> {
    const { instanceId, parameterId } = input;
    if (!Number.isFinite(input.value)) {
        throw new Error(`Refused a non-finite value for plugin parameter ${String(parameterId)}.`);
    }
    const snapshot = externalPluginParameterStore.value?.byInstanceId[instanceId];
    const parameter = snapshot?.parameters.find((candidate) => candidate.id === parameterId);
    if (!parameter) {
        throw new Error(`Plugin instance ${instanceId} has no parameter ${String(parameterId)}.`);
    }

    const value = Math.min(parameter.maxValue, Math.max(parameter.minValue, input.value));
    const key = `${instanceId}|${String(parameterId)}`;
    const send = ++nextSend;
    latestSend.set(key, send);

    try {
        await setPluginParameter({ instanceId, paramId: parameterId, value });
    } catch (error: unknown) {
        if (latestSend.get(key) === send) {
            latestSend.delete(key);
        }
        throw error;
    }

    if (latestSend.get(key) !== send) {
        return;
    }
    latestSend.delete(key);
    publishExternalPluginParameterEdit({ instanceId, parameterId, kind: 'value', value });
}
