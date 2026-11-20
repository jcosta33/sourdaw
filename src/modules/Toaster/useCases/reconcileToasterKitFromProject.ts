import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { markToasterKitCommitted } from '../models/ToasterKitCommitMarkers';
import { fromToasterKitState } from '../models/ToasterKitState';
import { discardPendingToasterKitUpdates, toasterStore } from '../stores/toasterStore';

import { loadToasterKitPreset } from './loadToasterKit';
import { observePublishedToasterKit } from './observePublishedToasterKit';
import { toasterRefusalEpisodes } from './toasterRefusalEpisodes';

export function reconcileToasterKitFromProject(
    deviceId: string,
    { committedReplacement = false }: { committedReplacement?: boolean } = {}
): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }
    const source = observePublishedToasterKit({ deviceId, trackId: target.trackId, committedReplacement });
    if (!source) {
        return;
    }
    const state = toasterStore.value?.[deviceId];
    if (!state) {
        discardPendingToasterKitUpdates(deviceId);
    }
    const kit = fromToasterKitState(source.chunk);
    if (state && jsonValuesEqual(state.kit, kit)) {
        return;
    }

    toasterRefusalEpisodes.end(deviceId);
    markToasterKitCommitted(kit);
    loadToasterKitPreset(deviceId, kit);
}
