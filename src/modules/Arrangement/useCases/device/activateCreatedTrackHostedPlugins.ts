import { getTrackStoreState } from '../getTrackStoreState';
import { projectTrackToLiveStrip } from '../projectTrackToLiveStrip';

import { collectHostedPluginInstances } from './collectHostedPluginInstances';

/**
 * Requests native instances for the hosted plugins of a track an action just created. The track
 * is re-read from the committed store, so a track the commit did not keep activates nothing.
 * Activation failures are reported by the plugin host's activation state, not thrown here.
 */
export function activateCreatedTrackHostedPlugins(trackId: string): void {
    const committed = getTrackStoreState()?.tracks.find((track) => track.id === trackId);
    if (!committed || collectHostedPluginInstances(committed).length === 0) {
        return;
    }
    projectTrackToLiveStrip({ trackId, activateDormantExternalPlugins: true });
}
