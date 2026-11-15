import { patchExternalPluginParameterValue } from '../../stores/externalPluginParameterStore';

import {
    type ExternalPluginParameterEdit,
    externalPluginParameterEditObservers,
} from './externalPluginParameterEditObservers';

export function announceExternalPluginParameterEdit(edit: ExternalPluginParameterEdit): void {
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
