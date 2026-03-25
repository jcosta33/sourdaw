import { pushStore } from '#/modules/Plugin/stores/push';

export function handlePadRelease(padIndex: number): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        pads: state.pads.map((p) => (p.index === padIndex ? { ...p, velocity: 0 } : p)),
    });
}
