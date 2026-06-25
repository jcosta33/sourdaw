import { updateClipInStore } from '#/modules/Arrangement/stores';

import { kneadStore, type KneadClipState } from '../stores/kneadStore';

export function updateClipKneadState(clipId: string, updater: (state: KneadClipState) => KneadClipState): void {
    const state = kneadStore.value;
    if (!state) {
        return;
    }

    const clipState = state.clips[clipId] ?? {
        clipId,
        blobs: [],
        retuneSpeedMs: 25,
        toleranceCents: 25,
        toleranceTimeMs: 30,
        humanizePercent: 40,
        formantPreserve: true,
    };

    const nextKneadState = updater(clipState);

    // Short-circuit no-op updates. A reference-equal result means the caller
    // only read the state (e.g. `s => s`); writing it anyway would seed magic
    // defaults for a clip that had none, fire a store notification, and trigger
    // a full per-track engine re-sync through the syncKneadToEngine subscriber.
    if (nextKneadState === clipState) {
        return;
    }

    kneadStore.set({
        ...state,
        clips: {
            ...state.clips,
            [clipId]: nextKneadState,
        },
    });

    updateClipInStore(clipId, (c) => ({ ...c, kneadState: nextKneadState }));
}
