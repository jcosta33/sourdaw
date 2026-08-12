import { pushHardwareTransport } from '../../repositories/pushHardwareTransport';
import { pushStore } from '../../stores/push';

export async function disconnectPush(): Promise<void> {
    let closeError: unknown;
    try {
        await pushHardwareTransport.disconnect();
    } catch (error) {
        closeError = error;
    }
    const state = pushStore.value;
    if (state) {
        pushStore.set({ ...state, connected: false, model: null });
    }
    if (closeError) {
        throw closeError instanceof Error ? closeError : new Error('Failed to close Ableton Push transport');
    }
}
