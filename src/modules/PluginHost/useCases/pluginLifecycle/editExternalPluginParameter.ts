import { setPluginParameter } from '../../repositories/pluginBridge/setPluginParameter';
import { externalPluginParameterStore } from '../../stores/externalPluginParameterStore';

import {
    beginHostParameterSend,
    endHostParameterSend,
    publishAcceptedHostParameterEdit,
} from './publishExternalPluginParameterEdit';

type EditExternalPluginParameterInput = {
    instanceId: string;
    parameterId: number;
    value: number;
};

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
 * is not finite, or the host refuses. Publication follows acceptance order: a
 * send accepted after a newer accepted send, or after the plugin published an
 * edit of its own, is dropped, so the snapshot always shows what the plugin
 * holds.
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
    const send = beginHostParameterSend(instanceId, parameterId);
    try {
        await setPluginParameter({ instanceId, paramId: parameterId, value });
        publishAcceptedHostParameterEdit(send, { instanceId, parameterId, kind: 'value', value });
    } finally {
        endHostParameterSend(send);
    }
}
