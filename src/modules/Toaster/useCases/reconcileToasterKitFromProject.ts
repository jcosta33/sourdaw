import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';

import { type ToasterKit } from '../models/ToasterKit';
import { markToasterKitCommitted } from '../models/ToasterKitCommitMarkers';
import { fromToasterKitState } from '../models/ToasterKitState';
import { discardPendingToasterKitUpdates, loadKit, toasterStore } from '../stores/toasterStore';

import { getToasterControls } from './getToasterControls';
import { loadToasterKitPreset } from './loadToasterKit';
import { observePublishedToasterKit } from './observePublishedToasterKit';
import { writeToasterKitScalar } from './toasterParamBridge/writeToasterKitScalar';
import { toasterRefusalEpisodes } from './toasterRefusalEpisodes';

function isMasterGainOnlyChange(previous: ToasterKit, next: ToasterKit): boolean {
    return (
        previous.masterGain !== next.masterGain && jsonValuesEqual({ ...previous, masterGain: next.masterGain }, next)
    );
}

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
    if (state && !committedReplacement && isMasterGainOnlyChange(state.kit, kit)) {
        loadKit(deviceId, kit);
        writeToasterKitScalar({
            trackId: target.trackId,
            deviceId,
            controls: getToasterControls(deviceId),
            name: 'master_gain',
            value: kit.masterGain,
            native: { kind: 'addressed' },
        });
        return;
    }
    loadToasterKitPreset(deviceId, kit);
}
