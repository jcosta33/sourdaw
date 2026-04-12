import { pushStore, PAD_MODE_COLORS, type PushPadMode } from '../../stores/push';

/**
 * Switch pad mode and update all pad colors atomically.
 *
 * FIX: The original implementation called updatePadColors() as a separate
 * function, which re-read the store after setPadMode had already written.
 * This caused a double store write (two subscriber notifications) for what
 * should be a single atomic state transition. Now consolidated into one write.
 */
export function setPadMode(mode: PushPadMode): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    const color = PAD_MODE_COLORS[mode];
    pushStore.set({
        ...state,
        padMode: mode,
        pads: state.pads.map((p) => ({ ...p, color })),
    });
}
