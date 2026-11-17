import { carriedExternalPluginStateFence } from './carriedExternalPluginStates';
import { projectSwitchLostPlugins } from './projectSwitchLostPlugins';
import { warnLiveStatesLost } from './warnLiveStatesLost';

/**
 * Settle what `unloadPluginsBeforeProjectSwitch` left pending.
 *
 * `switched` runs in the authority switch's own synchronous turn: every carry
 * is dropped there, because persisted instance ids return with the incoming
 * project, and the drop also fences any read batch still in flight. `refused`
 * keeps the carries for the outgoing project's rebuild and tells the user which
 * plugins come back without the edits their teardown could not read.
 */
export function settleProjectSwitchPluginTeardown(outcome: 'switched' | 'refused'): void {
    const lost = new Set(projectSwitchLostPlugins);
    projectSwitchLostPlugins.clear();
    if (outcome === 'switched') {
        carriedExternalPluginStateFence.dropAll();
        return;
    }
    warnLiveStatesLost(lost);
}
