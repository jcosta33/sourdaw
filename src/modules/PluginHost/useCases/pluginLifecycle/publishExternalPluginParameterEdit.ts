import { patchExternalPluginParameterValue } from '../../stores/externalPluginParameterStore';

import {
    type ExternalPluginParameterEdit,
    externalPluginParameterEditObservers,
} from './externalPluginParameterEditObservers';

/**
 * What has published for one parameter while a host send for it is in flight.
 * Ordering is by acceptance, not by when a send started: the plugin holds
 * whichever value it accepted last.
 */
type PublishRecord = {
    inFlight: number;
    /** Highest start of any host send that has published. */
    newestHostStart: number;
    /** Clock of the last plugin-originated value edit. */
    pluginEditAt: number;
};

const records = new Map<string, PublishRecord>();
let clock = 0;

function keyOf(instanceId: string, parameterId: number): string {
    return `${instanceId}|${String(parameterId)}`;
}

function notify(edit: ExternalPluginParameterEdit): void {
    // The host's own view of the parameter follows the plugin's. Without this a
    // knob turned in the plugin's editor leaves every reader of the snapshot —
    // the automation menu, lane range resolution — showing the value from before
    // the user touched it.
    if (edit.kind === 'value' && edit.value !== undefined) {
        patchExternalPluginParameterValue(edit.instanceId, edit.parameterId, edit.value);
    }

    for (const observe of externalPluginParameterEditObservers) {
        observe(edit);
    }
}

/**
 * Record and announce an edit the plugin itself made. It always publishes, and
 * supersedes every host send for the parameter that started before it.
 */
export function publishExternalPluginParameterEdit(edit: ExternalPluginParameterEdit): void {
    if (edit.kind === 'value') {
        const record = records.get(keyOf(edit.instanceId, edit.parameterId));
        if (record) {
            record.pluginEditAt = ++clock;
        }
    }
    notify(edit);
}

export type HostParameterSend = {
    key: string;
    started: number;
};

/** Open the ordering window of one host send; close it with {@link endHostParameterSend}. */
export function beginHostParameterSend(instanceId: string, parameterId: number): HostParameterSend {
    const key = keyOf(instanceId, parameterId);
    const record = records.get(key) ?? { inFlight: 0, newestHostStart: 0, pluginEditAt: 0 };
    record.inFlight += 1;
    records.set(key, record);
    return { key, started: ++clock };
}

/**
 * Publish an accepted host send unless a newer accepted send, or an edit the
 * plugin made, has published since it started.
 */
export function publishAcceptedHostParameterEdit(send: HostParameterSend, edit: ExternalPluginParameterEdit): void {
    const record = records.get(send.key);
    if (record && (record.newestHostStart > send.started || record.pluginEditAt > send.started)) {
        return;
    }
    if (record) {
        record.newestHostStart = send.started;
    }
    notify(edit);
}

/** Close a send's window; a key with nothing in flight keeps no record. */
export function endHostParameterSend(send: HostParameterSend): void {
    const record = records.get(send.key);
    if (!record) {
        return;
    }
    record.inFlight -= 1;
    if (record.inFlight <= 0) {
        records.delete(send.key);
    }
}
