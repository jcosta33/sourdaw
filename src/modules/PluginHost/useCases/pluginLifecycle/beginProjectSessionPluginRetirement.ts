import { carriedExternalPluginStateFence } from './carriedExternalPluginStates';
import { clearLoadedExternalPlugins } from './clearLoadedExternalPlugins';
import { externalPluginActivationEpoch, externalPluginActivationTasks } from './externalPluginActivationTasks';
import { externalPluginStateCaptureAuthority } from './externalPluginStateCaptureAuthority';
import { failUnresponsiveExternalPlugins } from './failUnresponsiveExternalPlugins';
import { pendingKeyedUnloads } from './pendingKeyedUnloads';
import { pluginLifecycleScheduler } from './serializePluginLifecycle';
import { unloadEveryPluginCarryingLiveState } from './unloadEveryPluginCarryingLiveState';
import { warnLiveStatesLost } from './warnLiveStatesLost';

/**
 * Fences plugin admission across a renderer project-session retirement.
 *
 * The retirement can still be cancelled after `retire`, and then the project's
 * graph is rebuilt from its own document, so `retire` carries every torn-down
 * instance's live state beside the carries the project already held. `reopen`
 * is that cancellation: the carries stay for the rebuild, and the user hears
 * which plugins come back without the edits their teardown could not read.
 * `release` is the session really ending: every carry is dropped, silently.
 */
export async function beginProjectSessionPluginRetirement(): Promise<{
    readonly retire: () => Promise<void>;
    readonly reopen: () => void;
    readonly release: () => void;
}> {
    const rebuild = await pluginLifecycleScheduler.beginRebuildAfterCurrent();
    externalPluginStateCaptureAuthority.invalidateAll();
    externalPluginActivationEpoch.current += 1;
    const admittedActivations = new Map(externalPluginActivationTasks);
    const admittedUnloads = new Map(pendingKeyedUnloads);
    const lostPlugins = new Set<string>();
    let reopened = false;
    function endFence(): void {
        if (reopened) {
            return;
        }
        reopened = true;
        rebuild.end();
    }
    return {
        retire: async (): Promise<void> => {
            failUnresponsiveExternalPlugins(
                await rebuild.waitForExistingOperations(admittedActivations),
                admittedUnloads
            );
            // The fence holds every lifecycle turn, so the reads run directly.
            await unloadEveryPluginCarryingLiveState('inside-lifecycle', lostPlugins);
            clearLoadedExternalPlugins();
        },
        reopen: (): void => {
            const lost = new Set(lostPlugins);
            lostPlugins.clear();
            warnLiveStatesLost(lost);
            endFence();
        },
        release: (): void => {
            lostPlugins.clear();
            carriedExternalPluginStateFence.dropAll();
            endFence();
        },
    };
}
