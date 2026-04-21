import { pushStore } from '../../stores/push';

export function mapEncoder(encoderIndex: number, parameterPath: string, label: string): void {
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({
        ...state,
        encoders: state.encoders.map((event) => (event.index === encoderIndex ? { ...event, parameterPath, label } : event)),
    });
}
