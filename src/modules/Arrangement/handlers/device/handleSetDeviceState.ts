import { logger } from '#/infra/logger/appLogger';
import { mirrorDeviceChainDelta, projectsToDifferentNativeBank } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

import { type Track } from '../../stores/trackStore';
import { setDeviceState } from '../../useCases/device/setDeviceState';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

function findOwningTrack(deviceId: string): Track | undefined {
    return getTrackStoreState()?.tracks.find((track) => track.devices.some((device) => device.id === deviceId));
}

/**
 * Whether this write moved the device's projected sample bank — a
 * `deviceState` change a rolling native session cannot hear on its own
 * (#4203): a Levain bank pick rebuilds a *held* instance, because the engine
 * has no door to change which bank an instance was built from. Every other
 * field either has no native projection or is folded into a body's
 * parameters, which the native session re-reads on its own schedule — except
 * Bacteria's modulation-routing table, which has a native projection that is
 * neither folded into parameters nor re-read mid-roll. That table only
 * reaches the native session through the Bacteria panel's `updateDevicePatch`
 * door, so an inbound `setDeviceState` with no panel mounted misses it too
 * (tracked by #4764).
 */
function projectedBankKeyChanged(before: Track, after: Track, deviceId: string): boolean {
    const beforeDevice = before.devices.find((device) => device.id === deviceId);
    const afterDevice = after.devices.find((device) => device.id === deviceId);
    if (!beforeDevice || !afterDevice) {
        return false;
    }
    return projectsToDifferentNativeBank(beforeDevice, afterDevice);
}

/**
 * Mirror the swap onto a rolling native session, and wait for none of it.
 *
 * The write above already reached project truth, and there is no Web Audio
 * carrier to re-run: `setDeviceState` never touches the graph, so the only
 * carrier this write can still owe anything to is a native session holding
 * the device this state belongs to. A native decline is deferred to the next
 * play and said out loud there, the same as every other mid-roll chain edit
 * (`mirrorDeviceChainDelta`'s own header) — so the failure here is logged and
 * swallowed rather than reported as a runtime-graph failure for a graph that
 * is intact.
 */
function mirrorNativeBankSwap(before: Track, after: Track): void {
    void mirrorDeviceChainDelta({ before, after }).catch((error: unknown) => {
        logger.warn(`[Arrangement] the native bank-key mirror for track ${after.id} failed: ${String(error)}`);
    });
}

export const handleSetDeviceState = createHandler<'setDeviceState'>({
    execute: (action) => {
        const { deviceId, state } = action.payload;
        const owningTrack = findOwningTrack(deviceId);
        const before = owningTrack ? structuredClone(owningTrack) : undefined;
        const didWrite = setDeviceState({ deviceId, state });
        if (!didWrite || !before) {
            return toHandlerExecutionResult(didWrite);
        }
        const after = getTrackStoreState()?.tracks.find((track) => track.id === before.id);
        if (!after || !projectedBankKeyChanged(before, after, deviceId)) {
            return { status: 'written' };
        }
        const mirror = (): void => mirrorNativeBankSwap(before, after);
        return { status: 'written', afterCommit: mirror, afterAmbiguousCommit: mirror };
    },
    // Not undoable, for the same reason as `setExternalPluginState`: this action
    // mirrors state a device already holds live rather than expressing a user edit.
    // Undoing it would rewind project truth while the device's own session store kept
    // the newer value, and the next mirror would simply write it back — an undo entry
    // that visibly does nothing.
    //
    // Device edits therefore still have no undo of their own; giving them one means
    // routing the edits themselves through actions, which is a larger change than
    // making them survive a reload and is deliberately not attempted here.
    describe: () => ({ label: 'Capture device state' }),
    undoable: false,
});
