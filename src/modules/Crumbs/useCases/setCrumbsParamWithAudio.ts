import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { executeAppAction } from '#/modules/Command/useCases';

import { type CrumbsPersistedParamId } from '../models/CrumbsParameterMap';
import { applyCrumbsParamValue, beginCrumbsParamPreview, endCrumbsParamPreview } from '../stores/crumbsStore';

import { cancelCrumbsParamPreview } from './crumbsParamBridge/cancelCrumbsParamPreview';
import { setCrumbsParamImmediate } from './crumbsParamBridge/setCrumbsParamImmediate';
import { setCrumbsParamThrottled } from './crumbsParamBridge/setCrumbsParamThrottled';

/**
 * Move one Crumbs knob, splitting the gesture from its commit.
 *
 * Two separate defects met here, and the second is why the first went unnoticed.
 *
 * **The knob value was not persisted at all.** Every Crumbs knob wrote
 * `crumbsStore` — a session store, keyed by device id, wiped on project load — and
 * forwarded the value to the backend. Nothing wrote `Device.parameterValues`, so a
 * filter cutoff survived exactly as long as the tab did. `CrumbsDeviceState` says of
 * the knobs that they "already ride `Device.parameterValues`"; they did not. That
 * comment described the intended design, and this is the code that makes it true.
 *
 * **The knob was not reaching the engine that renders.** Crumbs is built by
 * `wasmDeviceRegistry` and sounds through the `crumbs-processor` worklet, live and
 * in an offline bounce. `setCrumbsParamThrottled` addresses the *native*
 * `CrumbsInstance` behind the `set_crumbs_param` native command — the
 * sample-acquisition and disk-streaming path, not the one summed into the track
 * strip. So moving Cutoff moved a filter nobody could hear. Both halves below now
 * drive the worklet as well: `updateDeviceParam` → `TrackNode.updateParam` →
 * `CrumbsNode.setParam`. The ten ids in `CRUMBS_PERSISTED_PARAM_IDS` are matched
 * verbatim by the engine's `parse_crumbs_param`, so no name translation is needed
 * or wanted. The native write is kept on both halves rather than removed — that
 * instance is still the one the recorder and the streaming path talk to, and
 * silently desynchronising it is a second bug, not a cleanup.
 *
 * **A drag is one edit, not ninety.** `RotaryKnob` calls `onChange(value, true)` on
 * every pointer-move that crosses a step (`RotaryKnob.tsx:305`) and once more with
 * `false` on release (`:189`). Both Crumbs knob wrappers dropped that second
 * argument entirely, so there was no gesture boundary to commit on. The transient
 * half now previews and nothing else; the commit half dispatches one
 * `setDeviceParameter` through `executeAppAction`, which is what puts the move
 * inside an Automerge transaction and on the undo stack.
 *
 * `handleSetDeviceParameter.describe()` runs *before* the write and snapshots the
 * stored value as its `inverseAction`. Because the transient half never persists,
 * that snapshot is the value from before the gesture began rather than the
 * second-to-last drag sample — which is what makes one undo restore the whole sweep.
 *
 * Cost per gesture: one action, one Automerge transaction, one undo entry, and zero
 * project-truth writes during the drag.
 *
 * The session store is written on both halves. The panel is controlled off
 * `crumbsStore`, so a knob whose store field did not move would snap back to its
 * previous value on the next render while the user was still dragging it.
 *
 * The transient branch carries its own `resolveEligibleDeviceWriteTarget` gate
 * because it addresses the engine directly: a device id owned by no track, owned
 * twice, or owned by a track kind that does not accept device updates has no write
 * target, and pushing anyway writes to whichever device answers first. The commit
 * branch does not need one — `setDeviceParameter` resolves the same way behind the
 * action.
 */
export function setCrumbsParamWithAudio(
    deviceId: string,
    paramId: CrumbsPersistedParamId,
    value: number,
    isTransient = false
): void {
    if (!isTransient) {
        endCrumbsParamPreview(deviceId, paramId);
    }
    if (!Number.isFinite(value)) {
        return;
    }

    if (isTransient) {
        beginCrumbsParamPreview(deviceId, paramId);
    }
    applyCrumbsParamValue(deviceId, paramId, value);

    if (isTransient) {
        setCrumbsParamThrottled(deviceId, paramId, value);
        const target = resolveEligibleDeviceWriteTarget(deviceId);
        if (target.status !== 'eligible') {
            return;
        }
        updateDeviceParam(target.trackId, target.deviceId, paramId, value);
        return;
    }

    // Cancel first, then write the native instance immediately. Scheduling the
    // commit through the batcher and cancelling it in the same call would leave
    // the native engine holding the second-to-last drag sample forever.
    cancelCrumbsParamPreview(deviceId, paramId);
    setCrumbsParamImmediate(deviceId, paramId, value);
    void executeAppAction({
        type: 'setDeviceParameter',
        payload: { deviceId, paramId, value },
    });
}
