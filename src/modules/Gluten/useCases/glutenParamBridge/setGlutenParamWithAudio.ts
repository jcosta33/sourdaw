import { type GlutenPatch } from '../../models/GlutenPatch';
import { setGlutenParam } from '../../stores/glutenStore';

import { createFlushHandlers } from './createFlushHandlers';
import { bridgeDeps, encodeGlutenValue, paramBatcher } from './helpers';

const { previewParam } = createFlushHandlers(bridgeDeps);

/**
 * Move one Gluten parameter, splitting the gesture from its commit.
 *
 * **A drag is one edit, not ninety.** `RotaryKnob` calls `onChange(value, true)`
 * on every pointer-move that crosses a step (`RotaryKnob.tsx:305`) and once more
 * with `false` on release (`:189`). Until now every one of those went to
 * `persistDeviceParam`, which writes `trackStore` directly — outside
 * `executeAppAction`, so the whole sweep produced no undo entry at all while
 * still writing project truth once per animation frame.
 *
 * The transient half now drives only the engine, through the same rAF batcher as
 * before, so the compressor still responds under the user's thumb and project
 * truth is untouched. The commit half dispatches `setDeviceParameter` through
 * `executeAppAction`, which is what puts the move inside an Automerge
 * transaction and on the undo stack. `setDeviceParameter` itself clamps to the
 * declared range, calls `updateDeviceParam`, lands the value on
 * `Device.parameterValues` and records automation when the transport is in a
 * write mode — everything the old flush did, plus history.
 *
 * `handleSetDeviceParameter.describe()` runs *before* the write
 * (`executeAppAction.ts:90-92`) and snapshots the current stored value as its
 * `inverseAction`. Because the transient half no longer persists, that snapshot
 * is the value from before the gesture began rather than the second-to-last drag
 * sample — which is what makes one undo restore the whole sweep.
 *
 * Cost per gesture: one action, one Automerge transaction, one undo entry, and
 * strictly fewer project-truth writes during the drag than before.
 *
 * The pending preview is cancelled on commit: a rAF scheduled by the last
 * pointer-move would otherwise fire after the action and push a stale value back
 * into the engine, leaving audio and project truth disagreeing.
 */
export function setGlutenParamWithAudio<Key extends keyof GlutenPatch>(
    deviceId: string,
    key: Key,
    value: GlutenPatch[Key],
    isTransient = false
): void {
    const target = bridgeDeps.resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    setGlutenParam(deviceId, key, value);

    const encodedValue = encodeGlutenValue(key, value);
    if (encodedValue === null) {
        return;
    }

    const compositeKey = `${deviceId}:${key}`;
    if (isTransient) {
        paramBatcher.schedule(compositeKey, { deviceId, key, value: encodedValue }, previewParam);
        return;
    }

    paramBatcher.cancel(compositeKey);
    void bridgeDeps.executeAppAction({
        type: 'setDeviceParameter',
        payload: { deviceId: target.deviceId, paramId: key, value: encodedValue },
    });
}
