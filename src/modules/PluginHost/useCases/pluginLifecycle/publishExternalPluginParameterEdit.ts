import { announceExternalPluginParameterEdit } from './announceExternalPluginParameterEdit';
import { type ExternalPluginParameterEdit } from './externalPluginParameterEditObservers';
import { pluginEditCounts, pluginEditWatchKey } from './pluginEditWatches';

/**
 * Record and announce an edit the plugin itself made. It always publishes, and
 * supersedes any host send for the parameter that is outstanding.
 */
export function publishExternalPluginParameterEdit(edit: ExternalPluginParameterEdit): void {
    if (edit.kind === 'value') {
        const key = pluginEditWatchKey(edit.instanceId, edit.parameterId);
        const count = pluginEditCounts.get(key);
        if (count !== undefined) {
            pluginEditCounts.set(key, count + 1);
        }
    }
    announceExternalPluginParameterEdit(edit);
}
