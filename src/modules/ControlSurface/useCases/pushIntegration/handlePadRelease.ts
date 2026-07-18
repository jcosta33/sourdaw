import { pushStore } from '../../stores/push';

export function handlePadRelease(padIndex: number): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        pads: state.pads.map((param) => (param.index === padIndex ? { ...param, velocity: 0 } : param)),
    });
}
