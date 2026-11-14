import { patchExternalPluginParameterValue } from '../../stores/externalPluginParameterStore';

import {
    type ExternalPluginParameterEdit,
    externalPluginParameterEditObservers,
} from './externalPluginParameterEditObservers';

/**
 * How many edits the plugin itself has made to a parameter while the host has a
 * send for it outstanding. A send compares the count at dispatch with the count
 * at settlement: a plugin edit in between is the newer truth, and the send must
 * not overwrite it in the snapshot.
 *
 * Only parameters with a host send outstanding are held, so the map is empty
 * when the host is idle.
 */
const pluginEditCounts = new Map<string, number>();

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
 * supersedes any host send for the parameter that is outstanding.
 */
export function publishExternalPluginParameterEdit(edit: ExternalPluginParameterEdit): void {
    if (edit.kind === 'value') {
        const key = keyOf(edit.instanceId, edit.parameterId);
        const count = pluginEditCounts.get(key);
        if (count !== undefined) {
            pluginEditCounts.set(key, count + 1);
        }
    }
    notify(edit);
}

/** Announce a value the plugin accepted from the host's own control surface. */
export function publishHostParameterEdit(edit: ExternalPluginParameterEdit): void {
    notify(edit);
}

/** Start watching a parameter for plugin edits; pair with {@link stopWatchingPluginEdits}. */
export function startWatchingPluginEdits(instanceId: string, parameterId: number): void {
    pluginEditCounts.set(keyOf(instanceId, parameterId), 0);
}

export function pluginEditCount(instanceId: string, parameterId: number): number {
    return pluginEditCounts.get(keyOf(instanceId, parameterId)) ?? 0;
}

export function stopWatchingPluginEdits(instanceId: string, parameterId: number): void {
    pluginEditCounts.delete(keyOf(instanceId, parameterId));
}
