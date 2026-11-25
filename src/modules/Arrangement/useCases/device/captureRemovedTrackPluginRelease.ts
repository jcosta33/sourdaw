import { runAllAsyncEffects } from '#/utils/runEffects';

import { captureTrackRemovalRuntimeAuthority } from '../captureTrackRemovalRuntimeAuthority';
import { getTrackStoreState } from '../getTrackStoreState';

import { collectHostedPluginInstances } from './collectHostedPluginInstances';
import { unloadDiscardedHostedPlugins } from './unloadDiscardedHostedPlugins';

/**
 * For a caller outside the track-removal handlers that removes tracks through `removeTrack`: call it
 * before the removal, while the tracks still hold their devices, and run the returned release once
 * the write commits, or after an ambiguous commit. Each track's hosted instances are released only
 * while committed truth no longer holds that track and the project root is still the one captured.
 */
export function captureRemovedTrackPluginRelease(trackIds: readonly string[]): () => Promise<void> {
    const runtimeAuthority = captureTrackRemovalRuntimeAuthority();
    const tracks = getTrackStoreState()?.tracks ?? [];
    const releases = trackIds.flatMap((trackId) => {
        const track = tracks.find((candidate) => candidate.id === trackId);
        const instances = track ? collectHostedPluginInstances(track) : [];
        if (instances.length === 0) {
            return [];
        }
        return [runtimeAuthority.guardAbsent(trackId, () => unloadDiscardedHostedPlugins(instances))];
    });
    return () => runAllAsyncEffects(releases);
}
