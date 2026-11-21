import { getAutomationLanes } from '#/modules/Automation/useCases';
import { sidechainStore } from '#/modules/Routing/stores';
import { canonicalJson } from '#/utils/canonicalDigest';

import { type Track } from '../../models/Track';
import { trackStore } from '../../stores/trackStore';
import { getVcaGroupsState } from '../../stores/vcaGroupStore';
import { readOfflineRenderSubgraph } from '../readOfflineRenderSubgraph';

import { freezeSourceMixerKey } from './freezeSourceMixerKey';

/** Everything a freeze's render reads, as it stands now. */
export type FreezeSources = {
    /** The target and every track its render reads, ordered by track id. */
    tracks: Track[];
    /** Per track, in `tracks` order: its mixer and routing key, or '' for the target. */
    mixerKeys: string[];
    /** The sidechain routes joining two of the tracks. */
    routesKey: string;
};

/**
 * Reads the live sources of one freeze through the render's own subgraph selection, so the
 * signature cannot drift from what the render builds. `tracks` is empty when the target is gone.
 */
export function readFreezeSources(trackId: string): FreezeSources {
    const targetTrack = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
    if (!targetTrack) {
        return { tracks: [], mixerKeys: [], routesKey: '' };
    }
    const tracks = readOfflineRenderSubgraph(targetTrack, true).renderTracks.toSorted((left, right) =>
        left.id.localeCompare(right.id)
    );
    const automationLanes = getAutomationLanes();
    const vcaGroups = getVcaGroupsState();
    const memberIds = new Set(tracks.map((track) => track.id));
    const routes = (sidechainStore.value?.routes ?? []).filter(
        (route) => memberIds.has(route.sourceTrackId) && memberIds.has(route.targetTrackId)
    );
    return {
        tracks,
        mixerKeys: tracks.map((track) =>
            track.id === trackId ? '' : freezeSourceMixerKey({ track, automationLanes, vcaGroups })
        ),
        routesKey: canonicalJson(routes),
    };
}
