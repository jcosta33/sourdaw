import { stopRecording } from '../../repositories/samplerBridge';
import { samplerStore } from '../../stores/samplerStore';

export async function stopSamplerRecording(): Promise<void> {
    const state = samplerStore.value;
    if (!state?.instanceId) {return;}
    await stopRecording(state.instanceId);
}