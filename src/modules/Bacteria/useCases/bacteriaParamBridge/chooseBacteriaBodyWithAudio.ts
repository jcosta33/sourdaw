import { persistDeviceParam, resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
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
 * it from `parameterValues` like any other band parameter.
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
    paramBatcher.cancel(`${target.deviceId}:${paramId}`);
    recordNoBodyWhenUnset(target.deviceId, paramId);
    void executeUserAppAction({
        type: 'setDeviceParameter',
        payload: { deviceId: target.deviceId, paramId, value: encodeBacteriaBody(body) },
    });
}

/**
 * Give a band that has never had a body chosen its no-body value in the
 * document before the choice is committed.
 *
 * An undo restores the value the parameter held before the edit, and a
 * parameter the device declares no default for has nothing to restore when it
 * was never written — the per-band body is such a parameter, so its first
 * choice would land with no undo at all. Writing the no-body value first is not
 * a change anyone can hear or see: the band already plays and shows no body.
 */
function recordNoBodyWhenUnset(deviceId: string, paramId: string): void {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId);
    if (!device || Object.hasOwn(device.parameterValues, paramId)) {
        return;
    }
    persistDeviceParam(deviceId, paramId, NO_BODY_INDEX);
}
