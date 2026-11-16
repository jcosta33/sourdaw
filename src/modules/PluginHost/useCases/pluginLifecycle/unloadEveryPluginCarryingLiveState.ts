import { carryTeardownReads } from './carryTeardownReads';
import { loadedExternalInstances } from './loadedExternalInstances';
import { readLiveStatesForTeardown } from './readLiveStatesForTeardown';
import { unloadEveryPluginKeepingCarries } from './unloadEveryPluginKeepingCarries';

/**
 * The whole-runtime unload of a teardown that can still be undone: a project
 * replacement that can be refused, or a session retirement that can be
 * cancelled. Every loaded instance's live state is read first and carried for
 * the instances actually torn down, beside the carries the project already
 * held; the plugins whose live state that teardown lost are added to
 * `lostPlugins`, even when the unload fails, for the caller to report only if
 * the teardown is undone.
 *
 * `ordering` is `readLiveStatesForTeardown`'s: `inside-lifecycle` for a caller
 * holding the rebuild fence, which a scheduled read would wait on.
 */
export async function unloadEveryPluginCarryingLiveState(
    ordering: 'inside-lifecycle' | 'scheduled',
    lostPlugins: Set<string>
): Promise<void> {
    const loadedBeforeUnload = [...loadedExternalInstances];
    const reads = await readLiveStatesForTeardown(loadedBeforeUnload, ordering);
    try {
        await unloadEveryPluginKeepingCarries();
    } finally {
        const tornDown = loadedBeforeUnload.filter((instanceId) => !loadedExternalInstances.has(instanceId));
        for (const pluginId of carryTeardownReads(reads, tornDown)) {
            lostPlugins.add(pluginId);
        }
    }
}
