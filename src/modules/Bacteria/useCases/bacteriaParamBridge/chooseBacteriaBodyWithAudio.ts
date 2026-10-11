import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { encodeBacteriaBody, NO_BODY_INDEX } from '../../models/BacteriaBodyIndex';
import { type BacteriaConvolutionIr } from '../../models/BacteriaPatch';
import { getBacteriaState, setBacteriaBandParam } from '../../stores/bacteriaStore';

import { paramBatcher } from './helpers';

/**
 * Choose the built-in body one band's Body stage convolves with, or none.
 *
 * A body is one discrete choice rather than a drag, so it is committed as one
 * `setDeviceParameter` through the app-action door, which puts it on the undo
 * stack and in the document, and sends it to the engine — the web worklet and
 * the native engine alike — through `updateDeviceParam`. Everything that
 * rebuilds the device afterwards (a reload, a graph rebuild, an export) replays
 * it from `parameterValues` like any other band parameter. A band that has
 * never had a body stores nothing, which means no body: Bacteria's descriptor
 * records that, so undoing the band's first choice removes the value again.
 *
 * The session store moves first so the picker answers at once; the panel's
 * hydration re-projects it from the document after undo and redo.
 */
export function chooseBacteriaBodyWithAudio(deviceId: string, bandIndex: number, body: BacteriaConvolutionIr): void {
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }
    const bands = getBacteriaState(deviceId).patch.bands;
    if (bandIndex < 0 || bandIndex >= bands.length) {
        return;
    }

    setBacteriaBandParam(deviceId, bandIndex, 'convolutionIr', body);

    const paramId = `band${bandIndex}_convolutionIr`;
    const value = encodeBacteriaBody(body);
    paramBatcher.cancel(`${target.deviceId}:${paramId}`);
    if (storedBody(target.deviceId, paramId) === value) {
        return;
    }
    void executeUserAppAction({
        type: 'setDeviceParameter',
        payload: { deviceId: target.deviceId, paramId, value },
    });
}

/** The body index the document holds for a band, where absence is no body. */
function storedBody(deviceId: string, paramId: string): number {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId);
    return device?.parameterValues[paramId] ?? NO_BODY_INDEX;
}
