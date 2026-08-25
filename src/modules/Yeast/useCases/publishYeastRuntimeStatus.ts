import { getYeastRuntimeError, getYeastRuntimeStatus } from '../engine/yeastRuntime';
import { getPinnedYeastDevice, readYeastRack, setActiveYeastDevice, yeastStore } from '../stores/yeastStore';

/**
 * Publish the engine's runtime status onto the rack that just processed.
 * `rackId` is the device the processing used (threaded from
 * processYeastMidi); omitted, the status lands on the active rack (the
 * control-projection path, which runs against the active rack). A named
 * non-active device is written through a temporary pin — the pin switch
 * flushes the previous device's pending write under its own id first — and
 * the previous pin is restored, so the visible rack never moves.
 */
export function publishYeastRuntimeStatus(rackId?: string): void {
    const runtimeStatus = getYeastRuntimeStatus();
    const runtimeError = getYeastRuntimeError();

    if (rackId === undefined) {
        writeStatusToActiveRack(runtimeStatus, runtimeError);
        return;
    }
    const pinned = getPinnedYeastDevice();
    if (rackId === pinned) {
        writeStatusToActiveRack(runtimeStatus, runtimeError);
        return;
    }
    const rack = readYeastRack(rackId);
    if (rack.runtimeStatus === runtimeStatus && rack.runtimeError === runtimeError) {
        return;
    }
    setActiveYeastDevice(rackId);
    writeStatusToActiveRack(runtimeStatus, runtimeError);
    setActiveYeastDevice(pinned);
}

function writeStatusToActiveRack(
    runtimeStatus: ReturnType<typeof getYeastRuntimeStatus>,
    runtimeError: string | undefined
): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }
    if (state.runtimeStatus === runtimeStatus && state.runtimeError === runtimeError) {
        return;
    }

    const nextState = { ...state, runtimeStatus };
    if (runtimeError) {
        nextState.runtimeError = runtimeError;
    } else {
        delete nextState.runtimeError;
    }
    yeastStore.set(nextState);
}
