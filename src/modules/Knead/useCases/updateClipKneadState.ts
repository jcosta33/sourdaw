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

    kneadStore.set({
        ...state,
        clips: {
            ...state.clips,
            [clipId]: nextKneadState,
        },
    });

    updateClipInStore(clipId, (c) => ({ ...c, kneadState: nextKneadState }));
}
