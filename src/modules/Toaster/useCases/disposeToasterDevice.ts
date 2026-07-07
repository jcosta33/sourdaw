/**
 * Device-teardown orchestrator for one Toaster instance.
 *
 * Called from AudioEngine's wasmDeviceRegistry on destroy(). Before this
 * existed, teardown deleted only the store record (unregisterToasterDevice),
 * which left every other per-device session live:
 *   - the sequencer kept `running:true` and its next-tick setTimeout re-armed,
 *     firing ghost hits after the device was gone;
 *   - per-device note-repeat and 16-Levels sessions were never cleared;
 *   - a pad-param flush already queued on rAF could still fire post-destroy,
 *     writing to a detached worklet.
 *
 * Each step no-ops safely when there is no session/entry for the deviceId, so
 * calling this on a device that never started a sequencer (etc.) is harmless.
 * The store unregister runs last: stopping the timers first means no in-flight
 * tick can re-read (and so re-create) the store record after it is deleted.
 */

import { unregisterToasterDevice } from '../stores/toasterStore';

import { exit16Levels } from './exit16Levels';
import { stopNoteRepeat } from './stopNoteRepeat';
import { stopSequencer } from './stopSequencer';
import { cancelPendingToasterPadParams } from './toasterParamBridge/cancelPendingToasterPadParams';

export function disposeToasterDevice(deviceId: string): void {
    stopSequencer(deviceId);
    stopNoteRepeat(deviceId);
    exit16Levels(deviceId);
    cancelPendingToasterPadParams(deviceId);
    unregisterToasterDevice(deviceId);
}
