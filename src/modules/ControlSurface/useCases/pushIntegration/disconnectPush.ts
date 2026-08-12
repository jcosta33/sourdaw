import { pushHardwareTransport } from '../../repositories/pushHardwareTransport';
import { pushStore } from '../../stores/push';

export async function disconnectPush(): Promise<void> {
    await pushHardwareTransport.disconnect();
    const state = pushStore.value;
    if (!state) {
        return;
    }
    pushStore.set({ ...state, connected: false, model: null });
}
