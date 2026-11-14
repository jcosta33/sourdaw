import { setPluginParameter } from '../../repositories/pluginBridge/setPluginParameter';
import { type ExternalPluginParameter, externalPluginParameterStore } from '../../stores/externalPluginParameterStore';

import {
    pluginEditCount,
    publishHostParameterEdit,
    startWatchingPluginEdits,
    stopWatchingPluginEdits,
} from './publishExternalPluginParameterEdit';

type EditExternalPluginParameterInput = {
    instanceId: string;
    parameterId: number;
    value: number;
};

type Waiter = {
    resolve: () => void;
    reject: (error: unknown) => void;
};

type PendingSend = {
    value: number;
    waiters: Waiter[];
};

/**
 * The one send in flight for a parameter, and the newest request made behind
 * it. Held only while a send is outstanding, so the map is empty when idle.
 */
type ParameterSlot = {
    pending: PendingSend | null;
};

const slots = new Map<string, ParameterSlot>();

function findParameter(instanceId: string, parameterId: number): ExternalPluginParameter | undefined {
    return externalPluginParameterStore.value?.byInstanceId[instanceId]?.parameters.find(
        (candidate) => candidate.id === parameterId
    );
}

function clampToRange(parameter: ExternalPluginParameter, value: number): number {
    return Math.min(parameter.maxValue, Math.max(parameter.minValue, value));
}

/**
 * Send values one at a time. Two concurrent `set_plugin_parameter` commands can
 * be applied natively in either order, so neither start order nor
 * acknowledgement order says which value the plugin holds; only one send in
 * flight does. Each accepted send publishes in turn, so the snapshot ends on
 * the last value the plugin accepted.
 */
async function drain(instanceId: string, parameterId: number, first: PendingSend): Promise<void> {
    const key = `${instanceId}|${String(parameterId)}`;
    const slot: ParameterSlot = { pending: null };
    slots.set(key, slot);
    startWatchingPluginEdits(instanceId, parameterId);
    try {
        let current: PendingSend | null = first;
        while (current) {
            const parameter = findParameter(instanceId, parameterId);
            if (!parameter) {
                const gone = new Error(`Plugin instance ${instanceId} no longer has parameter ${String(parameterId)}.`);
                for (const waiter of current.waiters) {
                    waiter.reject(gone);
                }
                // Anything queued behind a vanished parameter has nowhere to go either.
                if (slot.pending) {
                    for (const waiter of slot.pending.waiters) {
                        waiter.reject(gone);
                    }
                    slot.pending = null;
                }
                return;
            }
            const value = clampToRange(parameter, current.value);
            const editsBefore = pluginEditCount(instanceId, parameterId);
            try {
                await setPluginParameter({ instanceId, paramId: parameterId, value });
            } catch (error: unknown) {
                for (const waiter of current.waiters) {
                    waiter.reject(error);
                }
                current = slot.pending;
                slot.pending = null;
                continue;
            }
            // An edit the plugin made while this send was out is the newer truth.
            if (pluginEditCount(instanceId, parameterId) === editsBefore) {
                publishHostParameterEdit({ instanceId, parameterId, kind: 'value', value });
            }
            for (const waiter of current.waiters) {
                waiter.resolve();
            }
            current = slot.pending;
            slot.pending = null;
        }
    } finally {
        stopWatchingPluginEdits(instanceId, parameterId);
        slots.delete(key);
    }
}

/**
 * Set a hosted plugin's parameter from the host's own control surface.
 *
 * The value is clamped to the parameter's declared range and sent to the plugin.
 * Only after the plugin accepts it does the snapshot move and the edit reach
 * observers, through the route a vendor-editor edit takes, so the project marks
 * itself dirty the same way. The native host does not echo a host-originated
 * set, which is why this publishes the edit itself.
 *
 * At most one send per parameter is in flight. A request made meanwhile replaces
 * the one waiting behind it, and goes out when the in-flight send settles, so
 * the plugin ends on the newest requested value. A call whose value was replaced
 * before it was sent settles with the outcome of the send that replaced it. An
 * edit the plugin itself publishes while a send is outstanding supersedes that
 * send: it still reaches the plugin but publishes nothing when it settles.
 *
 * Rejects without sending when the instance or parameter is unknown, the value
 * is not finite, or the parameter is gone by the time a queued value would be
 * sent; rejects with the host's refusal when the plugin refuses.
 */
export function editExternalPluginParameter(input: EditExternalPluginParameterInput): Promise<void> {
    const { instanceId, parameterId } = input;
    if (!Number.isFinite(input.value)) {
        return Promise.reject(new Error(`Refused a non-finite value for plugin parameter ${String(parameterId)}.`));
    }
    if (!findParameter(instanceId, parameterId)) {
        return Promise.reject(new Error(`Plugin instance ${instanceId} has no parameter ${String(parameterId)}.`));
    }

    return new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { resolve, reject };
        const slot = slots.get(`${instanceId}|${String(parameterId)}`);
        if (slot) {
            slot.pending = { value: input.value, waiters: [...(slot.pending?.waiters ?? []), waiter] };
            return;
        }
        void drain(instanceId, parameterId, { value: input.value, waiters: [waiter] });
    });
}
