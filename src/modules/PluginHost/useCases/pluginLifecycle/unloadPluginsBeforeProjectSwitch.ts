import { projectSwitchLostPlugins } from './projectSwitchLostPlugins';
import { unloadEveryPluginCarryingLiveState } from './unloadEveryPluginCarryingLiveState';

/**
 * The whole-runtime unload a project replacement runs before it is certain to
 * switch. The replacement can still be refused after it, and then the outgoing
 * project's graph is rebuilt from its own document, so every loaded instance's
 * live state is read first and carried for the instances actually torn down,
 * beside the carries the outgoing project already held.
 *
 * Those carries stay the outgoing project's until the replacement settles: a
 * refusal's rebuild, or a Play landing before the switch, consumes them; the
 * switch drops them all (`settleProjectSwitchPluginTeardown`). A failed read is
 * reported only on refusal, since only then does the plugin come back without it.
 */
export function unloadPluginsBeforeProjectSwitch(): Promise<void> {
    return unloadEveryPluginCarryingLiveState('scheduled', projectSwitchLostPlugins);
}
