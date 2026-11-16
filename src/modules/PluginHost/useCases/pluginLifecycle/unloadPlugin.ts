import { carriedExternalPluginStateFence } from './carriedExternalPluginStates';
import { scheduleKeyedUnload } from './scheduleKeyedUnload';
import { unloadEveryPluginKeepingCarries } from './unloadEveryPluginKeepingCarries';
import { unloadWithRetractedMirror } from './unloadWithRetractedMirror';

/**
 * Retire one external plugin instance, and everything this process recorded
 * about it; `unloadWithRetractedMirror` explains what the native graph does
 * with the hole and why the attach mirror is retracted across the unload.
 *
 * Without an instance id this is the whole-runtime unload a project
 * replacement or session retirement runs: the outgoing project's carries go
 * with it, even when the unload fails, and the drop also fences any read batch
 * still in flight from committing into the incoming project.
 */
export function unloadPlugin(instanceId?: string): Promise<void> {
    if (instanceId !== undefined) {
        return scheduleKeyedUnload(instanceId, () => unloadWithRetractedMirror(instanceId));
    }
    return unloadEveryPluginKeepingCarries().finally(() => carriedExternalPluginStateFence.dropAll());
}
