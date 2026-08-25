import { kneadStore, type KneadClipState } from '../stores/kneadStore';

function defaultClipState(clipId: string): KneadClipState {
    return {
        clipId,
        blobs: [],
        retuneSpeedMs: 25,
        toleranceCents: 25,
        toleranceTimeMs: 30,
        humanizePercent: 40,
        formantPreserve: true,
    };
}

/**
 * Shared body of both Knead write paths (see `updateClipKneadState` and
 * `updateTransientClipKneadState`): seed a default for a clip with no state,
 * apply the updater, and publish the result to the Knead store. Returns the
 * written state, or null when nothing was written.
 */
export function applyKneadClipState(
    clipId: string,
    updater: (state: KneadClipState) => KneadClipState
): KneadClipState | null {
    const state = kneadStore.value;
    if (!state) {
        return null;
    }

    const clipState = state.clips[clipId] ?? defaultClipState(clipId);

    const nextKneadState = updater(clipState);

    // Short-circuit no-op updates. A reference-equal result means the caller
    // only read the state (e.g. `s => s`); writing it anyway would seed magic
    // defaults for a clip that had none, fire a store notification, and trigger
    // a full per-track engine re-sync through the syncKneadToEngine subscriber.
    if (nextKneadState === clipState) {
        return null;
    }

    kneadStore.set({
        ...state,
        clips: {
            ...state.clips,
            [clipId]: nextKneadState,
        },
    });

    return nextKneadState;
}
