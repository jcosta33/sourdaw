import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { markToasterKitCommitted } from '../models/ToasterKitCommitMarkers';
import { fromToasterKitState } from '../models/ToasterKitState';
import { discardPendingToasterKitUpdates, loadKit, toasterStore } from '../stores/toasterStore';

import { getToasterControls } from './getToasterControls';
import { writeToasterParamsNatively } from './writeToasterParamsNatively';
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
    if (
        state &&
        !committedReplacement &&
        state.kit.masterGain !== kit.masterGain &&
        jsonValuesEqual({ ...state.kit, masterGain: kit.masterGain }, kit)
    ) {
        loadKit(deviceId, kit);
        getToasterControls(deviceId)?.setParam('master_gain', kit.masterGain);
        writeToasterParamsNatively({
            trackId: target.trackId,
            deviceId,
            messages: [{ type: 'param', name: 'master_gain', value: kit.masterGain }],
        });
        return;
    }
    loadToasterKitPreset(deviceId, kit);
}
