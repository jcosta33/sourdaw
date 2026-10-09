import { crumbsStore, type CrumbsState } from '../stores/crumbsStore';

/** One device's mirror pass: compare the store's playback key against the committed baseline and commit when it moved. */
export type CrumbsMirrorPass = (deviceId: string, state: CrumbsState) => void;

/**
 * The live mirror's per-device pass, registered by `initCrumbsDeviceStatePersistence`
 * and consumed by `replayCrumbsDeviceStateCommit`. A holder rather than a setter
 * function because the pass is state with one writer (the live mirror) and one
 * reader (the release replay), and use-case files export at most one function.
 */
export const liveCrumbsMirrorPass: { current: CrumbsMirrorPass | null } = { current: null };

/**
 * Replay the mirror's comparison for one device outside the store
 * subscription, against the committed baseline — the convergence point of a
 * released paired reconcile. A no-op when no mirror is live or the device has
 * no session state to mirror.
 */
export function replayCrumbsDeviceStateCommit(deviceId: string): void {
    const state = crumbsStore.value?.[deviceId];
    if (!state) {
        return;
    }
    liveCrumbsMirrorPass.current?.(deviceId, state);
}
