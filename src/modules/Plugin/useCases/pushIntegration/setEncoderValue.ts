import { pushStore } from '../../stores/push';

export function setEncoderValue(encoderIndex: number, value: number): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        encoders: state.encoders.map((e) =>
            e.index === encoderIndex ? { ...e, value: Math.max(0, Math.min(127, value)) } : e
        ),
    });
}
