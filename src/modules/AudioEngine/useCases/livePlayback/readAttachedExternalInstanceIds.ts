/**
 * The external plugin instances the native engine currently owns (#3563).
 *
 * PluginHost records the fact and this module reads it: an instance is attached
 * when `apply_graph_commands` reported it and `markExternalPluginEngineAttached`
 * wrote that report into the parameter snapshot. Read from the store rather than
 * remembered on the session because the two answers would drift the moment a
 * batch this module did not send attached something — a roll does, and so does
 * any later batch that finds a dormant instance.
 *
 * The absence of a snapshot is not an attachment: an instance nothing activated
 * in this generation has no engine behind it either, so it is left out exactly
 * as an activated-but-unattached one is.
 */

import { externalPluginParameterStore } from '#/modules/PluginHost/stores';

export function readAttachedExternalInstanceIds(): ReadonlySet<string> {
    const byInstanceId = externalPluginParameterStore.value?.byInstanceId ?? {};
    return new Set(
        Object.entries(byInstanceId)
            .filter(([, snapshot]) => snapshot.engineAttached)
            .map(([instanceId]) => instanceId)
    );
}
