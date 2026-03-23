import { pushStore, type PushPadColor } from '#/modules/Plugin/stores/push';

export function setPadColor(padIndex: number, color: PushPadColor): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        pads: state.pads.map((p) => (p.index === padIndex ? { ...p, color } : p)),
    });
}
