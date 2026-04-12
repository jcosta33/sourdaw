import { pushStore } from '../../stores/push';

/**
 * Handle a pad press event from the Push hardware.
 *
 * PERF NOTE: Maps over all 64 pads to update one. For high-frequency
 * real-time events, consider indexed access instead.
 */
export function handlePadPress(padIndex: number, velocity: number): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        pads: state.pads.map((p) => (p.index === padIndex ? { ...p, velocity } : p)),
    });
}
